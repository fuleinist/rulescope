/**
 * Discovery of AI instruction files in a repository.
 *
 * The set of known locations mirrors the agent load models in `agents.ts`.
 * Discovery is path-based: it does not read file contents.
 */
import { readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

export type InstructionKind =
  | 'agents-md'
  | 'claude-md'
  | 'claude-rules'
  | 'cursor-rules'
  | 'cursorrules'
  | 'copilot-instructions'
  | 'copilot-scoped'
  | 'gemini-md'
  | 'clinerules'
  | 'clinerules-dir'
  | 'windsurf-rules'
  | 'windsurfrules';

export interface DiscoveredFile {
  /** Repo-relative path with forward slashes. */
  rel: string;
  /** Absolute path on disk. */
  abs: string;
  /** Instruction file kind. */
  kind: InstructionKind;
}

export interface DiscoverOptions {
  /** Max directory levels above a file (default 6). */
  maxDepth?: number;
  /** Directory names to skip anywhere in the tree. */
  excludeDirs?: string[];
}

export const DEFAULT_EXCLUDE_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
];

/** Classify a repo-relative path. Returns null for non-instruction files. */
export function classifyInstructionFile(rel: string): InstructionKind | null {
  const name = rel.split('/').pop() ?? rel;
  if (name === 'AGENTS.md') return 'agents-md';
  if (name === 'CLAUDE.md') return 'claude-md';
  if (name === 'GEMINI.md') return 'gemini-md';
  if (rel === '.cursorrules') return 'cursorrules';
  if (rel === '.windsurfrules') return 'windsurfrules';
  if (rel === '.clinerules') return 'clinerules';
  if (rel === '.github/copilot-instructions.md') return 'copilot-instructions';
  if (rel.startsWith('.claude/rules/') && rel.endsWith('.md')) return 'claude-rules';
  if (rel.startsWith('.cursor/rules/') && rel.endsWith('.mdc')) return 'cursor-rules';
  if (rel.startsWith('.github/instructions/') && rel.endsWith('.instructions.md')) {
    return 'copilot-scoped';
  }
  if (rel.startsWith('.clinerules/') && rel.endsWith('.md')) return 'clinerules-dir';
  if (rel.startsWith('.windsurf/rules/') && rel.endsWith('.md')) return 'windsurf-rules';
  return null;
}

/** Find instruction files under `root`. Deterministic, sorted by relative path. */
export function discoverInstructionFiles(
  root: string,
  opts: DiscoverOptions = {},
): DiscoveredFile[] {
  const maxDepth = opts.maxDepth ?? 6;
  const exclude = new Set(opts.excludeDirs ?? DEFAULT_EXCLUDE_DIRS);
  const out: DiscoveredFile[] = [];
  const segCount = (relDir: string): number => (relDir === '' ? 0 : relDir.split('/').length);

  const walk = (absDir: string, relDir: string): void => {
    if (segCount(relDir) > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue;
        const childRel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        if (segCount(childRel) <= maxDepth) walk(join(absDir, entry.name), childRel);
      } else if (entry.isFile()) {
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        const kind = classifyInstructionFile(rel);
        if (kind) out.push({ rel, abs: join(absDir, entry.name), kind });
      }
    }
  };

  walk(root, '');
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}