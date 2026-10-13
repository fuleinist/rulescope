import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CLI = join('dist', 'src', 'cli.js');

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

test('scan reports a conflict and exits 1', () => {
  const r = runCli(['scan', 'test/fixtures/conflict']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('conflict'));
});

test('scan on a clean fixture exits 0', () => {
  const r = runCli(['scan', 'test/fixtures/clean']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('FINDINGS (0 errors, 0 warnings, 0 infos)'));
});

test('scan reports a dead ref and exits 1', () => {
  const r = runCli(['scan', 'test/fixtures/dead']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('src/missing.ts'));
});

test('scan --json produces the documented shape', () => {
  const r = runCli(['scan', 'test/fixtures/dead', '--json']);
  assert.equal(r.code, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.findings.length, 1);
  assert.equal(json.findings[0].kind, 'dead-ref');
  assert.equal(json.summary.exitCode, 1);
  assert.ok(json.files.some((f: { path: string }) => f.path === 'AGENTS.md'));
});

test('scan --cap overflow produces an overflow finding', () => {
  const r = runCli(['scan', 'test/fixtures/conflict', '--cap', 'claude=1']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes('OVERFLOW'));
});

test('scan --strict passes a warning-free fixture', () => {
  const r = runCli(['scan', 'test/fixtures/clean', '--strict']);
  assert.equal(r.code, 0);
});

test('explain prints the load chain for an agent', () => {
  const r = runCli(['explain', 'codex', 'test/fixtures/clean']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('agent: codex'));
  assert.ok(r.stdout.includes('AGENTS.md'));
});

test('explain rejects an unknown agent with exit 2', () => {
  const r = runCli(['explain', 'nope']);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.includes('unknown agent'));
});

test('no command prints usage and exits 2', () => {
  const r = runCli([]);
  assert.equal(r.code, 2);
  assert.ok(r.stdout.includes('Usage:'));
});