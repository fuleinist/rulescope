import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownRules, parseInstructionFile } from '../src/lib/parse.js';
import { estimateTokens } from '../src/lib/tokens.js';

test('extracts bullet items with line numbers and heading path', () => {
  const content = ['# Setup', '', '## Commands', '', '- Use pnpm for installs', '- Never commit to main'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    file: 'AGENTS.md',
    line: 5,
    heading: 'Setup > Commands',
    text: 'Use pnpm for installs',
  });
  assert.equal(rules[1].line, 6);
  assert.equal(rules[1].text, 'Never commit to main');
});

test('supports *, + and numbered markers', () => {
  const content = ['* alpha', '+ beta', '1. gamma', '2) delta'].join('\n');
  const rules = parseMarkdownRules('CLAUDE.md', content);
  assert.deepEqual(
    rules.map((r) => r.text),
    ['alpha', 'beta', 'gamma', 'delta'],
  );
});

test('joins wrapped continuation lines', () => {
  const content = ['- First rule line', '  continues here', '- Second rule'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].text, 'First rule line continues here');
  assert.equal(rules[0].line, 1);
  assert.equal(rules[1].text, 'Second rule');
  assert.equal(rules[1].line, 3);
});

test('ignores fenced code blocks', () => {
  const content = ['- Real rule', '', '```text', '- Not a rule', '```', '', '- After fence'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.deepEqual(
    rules.map((r) => r.text),
    ['Real rule', 'After fence'],
  );
});

test('ignores frontmatter and preserves line numbers', () => {
  const content = ['---', 'name: demo', 'version: 1.0.0', '---', '', '- Rule here'].join('\n');
  const rules = parseMarkdownRules('SKILL.md', content);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].line, 6);
  assert.equal(rules[0].text, 'Rule here');
});

test('ignores single-line and multi-line HTML comments', () => {
  const content = ['<!-- inline note -->', '<!--', '- hidden rule', '-->', '- visible rule'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.deepEqual(
    rules.map((r) => r.text),
    ['visible rule'],
  );
});

test('extracts standalone paragraphs', () => {
  const content = ['Some intro text.', 'More of the intro.', '', '- item'].join('\n');
  const rules = parseMarkdownRules('GEMINI.md', content);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].text, 'Some intro text. More of the intro.');
  assert.equal(rules[0].line, 1);
  assert.equal(rules[1].text, 'item');
});

test('skips table rows', () => {
  const content = ['- rule A', '| col | col |', '- rule B'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.deepEqual(
    rules.map((r) => r.text),
    ['rule A', 'rule B'],
  );
});

test('skips indented code lines', () => {
  const content = ['- rule', '', '    const x = 1;', '- next'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.deepEqual(
    rules.map((r) => r.text),
    ['rule', 'next'],
  );
});

test('heading context updates across levels', () => {
  const content = ['# A', '- r1', '## B', '- r2', '# C', '- r3'].join('\n');
  const rules = parseMarkdownRules('AGENTS.md', content);
  assert.deepEqual(
    rules.map((r) => r.heading),
    ['A', 'A > B', 'C'],
  );
});

test('emphasis at line start is a paragraph, not a list item', () => {
  const content = ['*italic text* stays paragraph'];
  const rules = parseMarkdownRules('AGENTS.md', content.join('\n'));
  assert.equal(rules.length, 1);
  assert.equal(rules[0].text, '*italic text* stays paragraph');
});

test('estimateTokens rounds up by quarters', () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(4), 1);
  assert.equal(estimateTokens(5), 2);
  assert.equal(estimateTokens(4000), 1000);
});

test('parseInstructionFile reports chars and tokens', () => {
  const parsed = parseInstructionFile('AGENTS.md', '- one rule\n');
  assert.equal(parsed.path, 'AGENTS.md');
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.chars, 11);
  assert.equal(parsed.tokens, 3);
});