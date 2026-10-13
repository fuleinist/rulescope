import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyInstructionFile, discoverInstructionFiles } from '../src/lib/discover.js';

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rulescope-discover-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

test('classifies all supported instruction file kinds', () => {
  assert.equal(classifyInstructionFile('AGENTS.md'), 'agents-md');
  assert.equal(classifyInstructionFile('sub/dir/AGENTS.md'), 'agents-md');
  assert.equal(classifyInstructionFile('CLAUDE.md'), 'claude-md');
  assert.equal(classifyInstructionFile('GEMINI.md'), 'gemini-md');
  assert.equal(classifyInstructionFile('.cursorrules'), 'cursorrules');
  assert.equal(classifyInstructionFile('.windsurfrules'), 'windsurfrules');
  assert.equal(classifyInstructionFile('.clinerules'), 'clinerules');
  assert.equal(classifyInstructionFile('.github/copilot-instructions.md'), 'copilot-instructions');
  assert.equal(classifyInstructionFile('.claude/rules/style.md'), 'claude-rules');
  assert.equal(classifyInstructionFile('.cursor/rules/a.mdc'), 'cursor-rules');
  assert.equal(
    classifyInstructionFile('.github/instructions/tests.instructions.md'),
    'copilot-scoped',
  );
  assert.equal(classifyInstructionFile('.clinerules/workflow.md'), 'clinerules-dir');
  assert.equal(classifyInstructionFile('.windsurf/rules/a.md'), 'windsurf-rules');
});

test('returns null for non-instruction files', () => {
  assert.equal(classifyInstructionFile('README.md'), null);
  assert.equal(classifyInstructionFile('docs/notes.txt'), null);
  assert.equal(classifyInstructionFile('.claude/rules/readme.txt'), null);
  assert.equal(classifyInstructionFile('.cursor/rules/a.md'), null);
});

test('discovers files and skips excluded directories', () => {
  const dir = makeTree({
    'AGENTS.md': 'a',
    'node_modules/pkg/AGENTS.md': 'a',
    '.git/AGENTS.md': 'a',
    'sub/CLAUDE.md': 'a',
    '.claude/rules/z.md': 'a',
  });
  try {
    const found = discoverInstructionFiles(dir);
    assert.deepEqual(
      found.map((f) => f.rel),
      ['.claude/rules/z.md', 'AGENTS.md', 'sub/CLAUDE.md'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('respects maxDepth', () => {
  const dir = makeTree({ 'a/b/AGENTS.md': 'x', 'a/AGENTS.md': 'y' });
  try {
    const d1 = discoverInstructionFiles(dir, { maxDepth: 1 });
    assert.deepEqual(
      d1.map((f) => f.rel),
      ['a/AGENTS.md'],
    );
    const d2 = discoverInstructionFiles(dir, { maxDepth: 2 });
    assert.deepEqual(
      d2.map((f) => f.rel),
      ['a/AGENTS.md', 'a/b/AGENTS.md'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty for a tree with no instruction files', () => {
  const dir = makeTree({ 'README.md': 'x', 'src/index.ts': 'y' });
  try {
    assert.deepEqual(discoverInstructionFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});