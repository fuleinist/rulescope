/**
 * Rule extraction from AI instruction files (Markdown).
 *
 * A rule is a list item (bullet or numbered, including wrapped continuation
 * lines) or a standalone paragraph block. Fenced code blocks, YAML
 * frontmatter, HTML comments, and table rows are ignored.
 */
import { estimateTokens } from './tokens.js';

export interface Rule {
  /** Repo-relative file path, forward slashes. */
  file: string;
  /** 1-based line number where the rule starts. */
  line: number;
  /** Heading path at the rule, e.g. "Setup > Commands". Empty string when none. */
  heading: string;
  /** Rule text: marker stripped, continuation lines joined with a space. */
  text: string;
}

export interface ParsedFile {
  /** Repo-relative file path, forward slashes. */
  path: string;
  rules: Rule[];
  chars: number;
  tokens: number;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const COMMENT_OPEN = /^\s*<!--/;
const TABLE_ROW = /^\s*\|/;
const CODE_INDENT = /^( {4,}|\t)/;

/** True when a line cannot continue a rule body (it ends the current block). */
function isRuleBreak(line: string): boolean {
  return (
    line.trim() === '' ||
    HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    FENCE.test(line) ||
    COMMENT_OPEN.test(line) ||
    TABLE_ROW.test(line) ||
    CODE_INDENT.test(line)
  );
}

/** Blank out a leading YAML frontmatter block. Line numbers stay aligned. */
function blankFrontmatter(lines: string[]): void {
  if (lines.length === 0 || lines[0].trim() !== '---') return;
  const limit = Math.min(lines.length, 100);
  for (let k = 1; k < limit; k++) {
    if (lines[k].trim() === '---') {
      for (let m = 0; m <= k; m++) lines[m] = '';
      return;
    }
  }
}

/** Extract rules from Markdown content. `file` is used in the rule records. */
export function parseMarkdownRules(file: string, content: string): Rule[] {
  const lines = content.split(/\r?\n/);
  blankFrontmatter(lines);

  const rules: Rule[] = [];
  const headings: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 3;
  let inComment = false;

  const headingPath = (): string => headings.join(' > ');

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];

    if (inFence) {
      const close = line.match(FENCE);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        inFence = false;
      }
      i += 1;
      continue;
    }

    if (inComment) {
      if (line.includes('-->')) inComment = false;
      i += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      inFence = true;
      fenceChar = fence[1][0];
      fenceLen = fence[1].length;
      i += 1;
      continue;
    }

    if (line.includes('<!--')) {
      if (!line.includes('-->')) inComment = true;
      i += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      headings.splice(level - 1, headings.length, heading[2].trim());
      i += 1;
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const start = i;
      const parts = [item[3].trim()];
      let j = i + 1;
      while (j < lines.length && !isRuleBreak(lines[j])) {
        parts.push(lines[j].trim());
        j += 1;
      }
      rules.push({ file, line: start + 1, heading: headingPath(), text: parts.join(' ') });
      i = j;
      continue;
    }

    if (TABLE_ROW.test(line) || CODE_INDENT.test(line)) {
      i += 1;
      continue;
    }

    if (line.trim() !== '') {
      const start = i;
      const parts = [line.trim()];
      let j = i + 1;
      while (j < lines.length && !isRuleBreak(lines[j])) {
        parts.push(lines[j].trim());
        j += 1;
      }
      rules.push({ file, line: start + 1, heading: headingPath(), text: parts.join(' ') });
      i = j;
      continue;
    }

    i += 1;
  }

  return rules;
}

/** Parse one instruction file: rules plus size and token estimates. */
export function parseInstructionFile(relPath: string, content: string): ParsedFile {
  return {
    path: relPath,
    rules: parseMarkdownRules(relPath, content),
    chars: content.length,
    tokens: estimateTokens(content.length),
  };
}