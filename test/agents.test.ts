import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DiscoveredFile } from '../src/lib/discover.js';
import { agentById, agentsFor, capFor, loadSet, roleOf } from '../src/lib/agents.js';

function file(rel: string, kind: DiscoveredFile['kind']): DiscoveredFile {
  return { rel, abs: '/repo/' + rel, kind };
}

test('agentsFor maps kinds to agent ids', () => {
  assert.deepEqual(agentsFor('agents-md'), ['claude', 'codex']);
  assert.deepEqual(agentsFor('claude-md'), ['claude']);
  assert.deepEqual(agentsFor('cursor-rules'), ['cursor']);
  assert.deepEqual(agentsFor('gemini-md'), ['gemini']);
});

test('loadSet orders by precedence, then depth, then path', () => {
  const files = [
    file('sub/AGENTS.md', 'agents-md'),
    file('CLAUDE.md', 'claude-md'),
    file('.claude/rules/z.md', 'claude-rules'),
    file('AGENTS.md', 'agents-md'),
  ];
  const claude = agentById('claude');
  assert.ok(claude);
  assert.deepEqual(
    loadSet(claude, files).map((f) => f.rel),
    ['CLAUDE.md', '.claude/rules/z.md', 'AGENTS.md', 'sub/AGENTS.md'],
  );
  const codex = agentById('codex');
  assert.ok(codex);
  assert.deepEqual(
    loadSet(codex, files).map((f) => f.rel),
    ['AGENTS.md', 'sub/AGENTS.md'],
  );
});

test('loadSet filters by accepted kinds', () => {
  const files = [
    file('.cursorrules', 'cursorrules'),
    file('.cursor/rules/a.mdc', 'cursor-rules'),
    file('CLAUDE.md', 'claude-md'),
  ];
  const cursor = agentById('cursor');
  assert.ok(cursor);
  assert.deepEqual(
    loadSet(cursor, files).map((f) => f.rel),
    ['.cursor/rules/a.mdc', '.cursorrules'],
  );
});

test('roleOf labels files across roles', () => {
  const claude = agentById('claude');
  assert.ok(claude);
  assert.equal(roleOf(file('AGENTS.md', 'agents-md'), claude), 'fallback');
  assert.equal(roleOf(file('CLAUDE.md', 'claude-md'), claude), 'root');
  assert.equal(roleOf(file('sub/CLAUDE.md', 'claude-md'), claude), 'nested');
  assert.equal(roleOf(file('.claude/rules/a.md', 'claude-rules'), claude), 'rules-dir');
  const copilot = agentById('copilot');
  assert.ok(copilot);
  assert.equal(
    roleOf(file('.github/copilot-instructions.md', 'copilot-instructions'), copilot),
    'root',
  );
});

test('capFor uses overrides when valid', () => {
  const claude = agentById('claude');
  assert.ok(claude);
  assert.equal(capFor(claude), 8000);
  assert.equal(capFor(claude, { claude: 100 }), 100);
  assert.equal(capFor(claude, { claude: Number.NaN }), 8000);
  assert.equal(capFor(claude, {}), 8000);
});