/**
 * Agent load models: which instruction files each coding agent reads.
 *
 * The models are approximations based on public documentation (Oct 2026).
 * They exist to answer "what does each agent load" for a given repository.
 * Precedence is expressed as the order of accepted kinds (highest first).
 */
import type { DiscoveredFile, InstructionKind } from './discover.js';

export interface AgentModel {
  id: string;
  name: string;
  /** Accepted kinds in precedence order (highest first). */
  accepts: InstructionKind[];
  /** True when nested copies load while the agent works in that subtree. */
  nested: boolean;
  /** Default token cap for the context-overflow check. Approximate. */
  cap: number;
}

export const AGENTS: AgentModel[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    accepts: ['claude-md', 'claude-rules', 'agents-md'],
    nested: true,
    cap: 8000,
  },
  { id: 'codex', name: 'Codex', accepts: ['agents-md'], nested: true, cap: 6000 },
  { id: 'cursor', name: 'Cursor', accepts: ['cursor-rules', 'cursorrules'], nested: false, cap: 6000 },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    accepts: ['copilot-instructions', 'copilot-scoped'],
    nested: false,
    cap: 4000,
  },
  { id: 'gemini', name: 'Gemini CLI', accepts: ['gemini-md'], nested: true, cap: 6000 },
  { id: 'cline', name: 'Cline', accepts: ['clinerules', 'clinerules-dir'], nested: false, cap: 6000 },
  {
    id: 'windsurf',
    name: 'Windsurf',
    accepts: ['windsurf-rules', 'windsurfrules'],
    nested: false,
    cap: 6000,
  },
];

export function agentById(id: string): AgentModel | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Agent ids that load a given instruction file kind. */
export function agentsFor(kind: InstructionKind): string[] {
  return AGENTS.filter((a) => a.accepts.includes(kind)).map((a) => a.id);
}

export type LoadRole = 'root' | 'nested' | 'rules-dir' | 'fallback';

const RULES_DIR_KINDS: InstructionKind[] = [
  'claude-rules',
  'cursor-rules',
  'copilot-scoped',
  'clinerules-dir',
  'windsurf-rules',
];

const FIXED_ROOT_KINDS: InstructionKind[] = [
  'cursorrules',
  'windsurfrules',
  'clinerules',
  'copilot-instructions',
];

/** Role of a file within an agent's load chain. */
export function roleOf(file: DiscoveredFile, agent: AgentModel): LoadRole {
  if (file.kind === 'agents-md' && agent.id === 'claude') return 'fallback';
  if (RULES_DIR_KINDS.includes(file.kind)) return 'rules-dir';
  if (FIXED_ROOT_KINDS.includes(file.kind)) return 'root';
  return file.rel.includes('/') ? 'nested' : 'root';
}

/** Files of one agent's accepted kinds, in precedence order. */
export function loadSet(agent: AgentModel, files: DiscoveredFile[]): DiscoveredFile[] {
  const depth = (rel: string): number => rel.split('/').length - 1;
  return files
    .filter((f) => agent.accepts.includes(f.kind))
    .sort((a, b) => {
      const pa = agent.accepts.indexOf(a.kind);
      const pb = agent.accepts.indexOf(b.kind);
      if (pa !== pb) return pa - pb;
      const da = depth(a.rel);
      const db = depth(b.rel);
      if (da !== db) return da - db;
      return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
    });
}

/** Effective token cap for an agent, applying CLI overrides when valid. */
export function capFor(agent: AgentModel, overrides?: Record<string, number>): number {
  const o = overrides?.[agent.id];
  return typeof o === 'number' && Number.isFinite(o) && o > 0 ? o : agent.cap;
}