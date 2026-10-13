import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeExitCode, renderJson, renderText, type ScanResult } from '../src/lib/report.js';

const result: ScanResult = {
  root: '.',
  files: [
    { path: 'AGENTS.md', kind: 'agents-md', rules: 2, chars: 40, tokens: 10, agents: ['claude', 'codex'] },
    { path: 'CLAUDE.md', kind: 'claude-md', rules: 1, chars: 20, tokens: 5, agents: ['claude'] },
  ],
  agents: [
    { id: 'claude', name: 'Claude Code', files: ['CLAUDE.md', 'AGENTS.md'], tokens: 15, cap: 8000, status: 'ok' },
  ],
  findings: [
    {
      kind: 'dead-ref',
      severity: 'error',
      message: 'references a path that does not exist: x',
      locations: [{ path: 'AGENTS.md', line: 2 }],
    },
  ],
  summary: { errors: 1, warnings: 0, infos: 0 },
};

test('renderText includes sections, findings and exit line', () => {
  const text = renderText(result, {});
  assert.match(text, /^rulescope - 2 files, 3 rules, ~15 tokens/);
  assert.ok(text.includes('FILES'));
  assert.ok(text.includes('AGENT MATRIX'));
  assert.ok(text.includes('FINDINGS (1 errors, 0 warnings, 0 infos)'));
  assert.ok(text.includes('ERROR dead-ref'));
  assert.ok(text.includes('exit 1'));
});

test('renderJson produces the documented shape', () => {
  const json = JSON.parse(renderJson(result, {}));
  assert.equal(json.root, '.');
  assert.equal(json.files.length, 2);
  assert.equal(json.agents[0].id, 'claude');
  assert.equal(json.agents[0].status, 'ok');
  assert.equal(json.findings[0].kind, 'dead-ref');
  assert.equal(json.findings[0].locations[0].path, 'AGENTS.md');
  assert.equal(json.summary.exitCode, 1);
});

test('warning-only results pass unless strict', () => {
  const warnOnly: ScanResult = {
    ...result,
    findings: [
      { kind: 'duplicate', severity: 'warn', message: 'd', locations: [] },
    ],
    summary: { errors: 0, warnings: 1, infos: 0 },
  };
  assert.equal(computeExitCode(warnOnly, false), 0);
  assert.equal(computeExitCode(warnOnly, true), 1);
  const clean: ScanResult = {
    ...result,
    findings: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
  };
  assert.equal(computeExitCode(clean, true), 0);
  assert.ok(renderText(clean, {}).includes('none'));
});