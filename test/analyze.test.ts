import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyze } from '../src/lib/analyze.js';
import { discoverInstructionFiles } from '../src/lib/discover.js';
import { parseInstructionFile, type ParsedFile } from '../src/lib/parse.js';
import type { DiscoveredFile } from '../src/lib/discover.js';

function setup(files: Record<string, string>): {
  dir: string;
  discovered: DiscoveredFile[];
  parsed: ParsedFile[];
} {
  const dir = mkdtempSync(join(tmpdir(), 'rulescope-analyze-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const discovered = discoverInstructionFiles(dir);
  const parsed = discovered.map((f) =>
    parseInstructionFile(f.rel, readFileSync(f.abs, 'utf8')),
  );
  return { dir, discovered, parsed };
}

test('detects a conflict between opposite markers with a shared topic', () => {
  const { dir, discovered, parsed } = setup({
    'CLAUDE.md': '- Use tabs for indentation\n',
    'GEMINI.md': '- Use spaces for indentation\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    assert.equal(res.findings.length, 1);
    const c = res.findings[0];
    assert.equal(c.kind, 'conflict');
    assert.equal(c.severity, 'error');
    assert.deepEqual(
      c.locations.map((l) => l.path).sort(),
      ['CLAUDE.md', 'GEMINI.md'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not flag rules without a shared topic (negative control)', () => {
  const { dir, discovered, parsed } = setup({
    'CLAUDE.md': '- Use tabs for indentation\n',
    'GEMINI.md': '- Avoid spaces inside string literals\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    assert.equal(res.findings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects duplicates and keeps the negative control clean', () => {
  const { dir, discovered, parsed } = setup({
    'AGENTS.md': '- Run the linter before commit\n',
    'CLAUDE.md': '- run the linter before commit!\n',
    'GEMINI.md': '- Run the linter before you commit\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    const dups = res.findings.filter((f) => f.kind === 'duplicate');
    assert.equal(dups.length, 1);
    assert.equal(dups[0].severity, 'warn');
    assert.equal(dups[0].locations.length, 2);
    assert.deepEqual(
      dups[0].locations.map((l) => l.path),
      ['AGENTS.md', 'CLAUDE.md'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects a near-duplicate but not an exact duplicate', () => {
  const { dir, discovered, parsed } = setup({
    'AGENTS.md': '- Run tests before every commit and push\n',
    'CLAUDE.md': '- Always run tests before every commit and push\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    const near = res.findings.filter((f) => f.kind === 'near-duplicate');
    assert.equal(near.length, 1);
    assert.equal(near[0].severity, 'info');
    assert.equal(res.findings.filter((f) => f.kind === 'duplicate').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags dead refs; existing paths and async/await stay clean', () => {
  const { dir, discovered, parsed } = setup({
    'AGENTS.md': [
      '- Read `docs/guide.md` first',
      '- See src/missing.ts for details',
      '- Look at `docs/` for guides',
      '- Prefer async/await over callbacks',
      '- Run `scripts/build.sh` before release',
    ].join('\n'),
    'docs/guide.md': '# Guide\n',
    'scripts/build.sh': '#!/bin/sh\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    assert.equal(res.findings.length, 1);
    const f = res.findings[0];
    assert.equal(f.kind, 'dead-ref');
    assert.equal(f.severity, 'error');
    assert.ok(f.message.includes('src/missing.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports shadowed rules for the right agent', () => {
  const { dir, discovered, parsed } = setup({
    'CLAUDE.md': '- Always write tests first\n',
    'AGENTS.md': '- Always write tests first\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed });
    const shadowed = res.findings.filter((f) => f.kind === 'shadowed');
    assert.equal(shadowed.length, 1);
    assert.equal(shadowed[0].severity, 'info');
    assert.equal(shadowed[0].locations[0].path, 'CLAUDE.md');
    assert.equal(shadowed[0].locations[1].path, 'AGENTS.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags overflow when tokens exceed the cap', () => {
  const { dir, discovered, parsed } = setup({
    'AGENTS.md': '- abcdefgh\n',
  });
  try {
    const res = analyze({ root: dir, discovered, parsed, capOverrides: { codex: 2 } });
    const overflow = res.findings.filter((f) => f.kind === 'overflow');
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].severity, 'error');
    assert.ok(overflow[0].message.includes('codex'));
    const codex = res.agents.find((a) => a.id === 'codex');
    assert.ok(codex);
    assert.equal(codex.status, 'overflow');
    assert.equal(codex.cap, 2);
    assert.equal(codex.tokens, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags near-cap within 80-100% and stays ok below', () => {
  const { dir, discovered, parsed } = setup({
    'AGENTS.md': '- abcdefgh\n',
  });
  try {
    const nearRes = analyze({ root: dir, discovered, parsed, capOverrides: { codex: 3 } });
    const near = nearRes.findings.filter((f) => f.kind === 'near-cap');
    assert.equal(near.length, 1);
    assert.equal(near[0].severity, 'warn');
    const codexNear = nearRes.agents.find((a) => a.id === 'codex');
    assert.ok(codexNear);
    assert.equal(codexNear.status, 'near-cap');

    const okRes = analyze({ root: dir, discovered, parsed, capOverrides: { codex: 10 } });
    assert.equal(okRes.findings.length, 0);
    const codexOk = okRes.agents.find((a) => a.id === 'codex');
    assert.ok(codexOk);
    assert.equal(codexOk.status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});