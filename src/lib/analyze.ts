/**
 * Analysis engine: findings across instruction files and agent load sets.
 *
 * Checks:
 * - conflict: two rules with opposite markers and a shared topic token
 * - duplicate: identical normalized rule text
 * - near-duplicate: token-set Jaccard similarity >= 0.85
 * - dead-ref: a referenced path does not exist in the repository
 * - shadowed: same rule text appears at lower precedence for one agent
 * - overflow / near-cap: agent load-set token estimate against its cap
 */
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { AGENTS, capFor, loadSet, type AgentModel } from './agents.js';
import { DEFAULT_EXCLUDE_DIRS, type DiscoveredFile } from './discover.js';
import type { ParsedFile, Rule } from './parse.js';
import { jaccard, normalizeRuleText, tokenSet, truncate } from './util.js';

export type Severity = 'error' | 'warn' | 'info';

export type FindingKind =
  | 'conflict'
  | 'duplicate'
  | 'near-duplicate'
  | 'dead-ref'
  | 'shadowed'
  | 'overflow'
  | 'near-cap';

export interface Location {
  path: string;
  line: number;
}

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  message: string;
  locations: Location[];
}

export interface AgentSummary {
  id: string;
  name: string;
  files: string[];
  tokens: number;
  cap: number;
  status: 'ok' | 'near-cap' | 'overflow';
}

export interface AnalyzeInput {
  root: string;
  discovered: DiscoveredFile[];
  parsed: ParsedFile[];
  capOverrides?: Record<string, number>;
  agents?: AgentModel[];
}

export interface AnalyzeResult {
  findings: Finding[];
  agents: AgentSummary[];
}

const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while', 'for', 'from',
  'with', 'without', 'not', 'no', 'do', 'does', 'don', 'doesn', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'it', 'its', 'this', 'that', 'these',
  'those', 'you', 'your', 'we', 'our', 'they', 'their', 'them', 'all', 'any', 'can', 'may',
  'should', 'would', 'could', 'must', 'will', 'have', 'has', 'had', 'use', 'using', 'used',
  'avoid', 'avoiding', 'include', 'includes', 'excluding', 'exclude', 'excludes', 'always',
  'never', 'one', 'two', 'more', 'most', 'less', 'than', 'so', 'such', 'only', 'also', 'just',
  'about', 'into', 'over', 'under', 'out', 'up', 'down', 'off', 'each', 'every', 'new', 'old',
]);

interface AntonymPair {
  id: string;
  a: RegExp;
  b: RegExp;
  markers: string[];
}

const ANTONYM_PAIRS: AntonymPair[] = [
  {
    id: 'tabs-vs-spaces',
    a: /\btabs?\b/i,
    b: /\bspaces?\b/i,
    markers: ['tab', 'tabs', 'space', 'spaces'],
  },
  {
    id: 'single-vs-double-quotes',
    a: /\bsingle\s+quotes?\b/i,
    b: /\bdouble\s+quotes?\b/i,
    markers: ['single', 'double', 'quote', 'quotes'],
  },
  {
    id: 'always-vs-never',
    a: /\balways\b/i,
    b: /\bnever\b/i,
    markers: ['always', 'never'],
  },
  {
    id: 'must-vs-must-not',
    a: /\bmust\b(?!\s+not\b)/i,
    b: /\bmust not\b/i,
    markers: ['must', 'not'],
  },
  {
    id: 'use-vs-avoid',
    a: /\buse\b/i,
    b: /\bavoid\b/i,
    markers: ['use', 'using', 'avoid', 'avoiding'],
  },
  {
    id: 'include-vs-exclude',
    a: /\binclude\b/i,
    b: /\bexclude\b/i,
    markers: ['include', 'includes', 'excluding', 'exclude', 'excludes'],
  },
];

function sharedTopic(one: string, other: string, pair: AntonymPair): string | null {
  const a = tokenSet(one);
  const b = tokenSet(other);
  const exclude = new Set<string>([...STOPWORDS, ...pair.markers]);
  for (const t of a) {
    if (t.length < 4 || exclude.has(t)) continue;
    if (b.has(t)) return t;
  }
  return null;
}

function conflictsAmong(rules: Rule[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const pair of ANTONYM_PAIRS) {
    const sideA: Rule[] = [];
    const sideB: Rule[] = [];
    for (const r of rules) {
      const am = pair.a.test(r.text);
      const bm = pair.b.test(r.text);
      if (am && !bm) sideA.push(r);
      else if (bm && !am) sideB.push(r);
    }
    for (const ra of sideA) {
      for (const rb of sideB) {
        if (out.length >= 200) return out;
        if (!sharedTopic(ra.text, rb.text, pair)) continue;
        const key = [
          [`${ra.file}:${ra.line}`, `${rb.file}:${rb.line}`].sort().join('~'),
          pair.id,
        ].join('~');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kind: 'conflict',
          severity: 'error',
          message: `possible conflict (${pair.id}): "${truncate(ra.text, 40)}" vs "${truncate(rb.text, 40)}"`,
          locations: [
            { path: ra.file, line: ra.line },
            { path: rb.file, line: rb.line },
          ],
        });
      }
    }
  }
  return out;
}

function cmpLoc(a: Location, b: Location): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.line - b.line;
}

function duplicatesAmong(rules: Rule[]): Finding[] {
  const groups = new Map<string, Rule[]>();
  for (const r of rules) {
    const norm = normalizeRuleText(r.text);
    if (norm === '') continue;
    const g = groups.get(norm);
    if (g) g.push(r);
    else groups.set(norm, [r]);
  }
  const out: Finding[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    out.push({
      kind: 'duplicate',
      severity: 'warn',
      message: `duplicate rule text (${g.length} occurrences): "${truncate(g[0].text, 60)}"`,
      locations: g.map((r) => ({ path: r.file, line: r.line })).sort(cmpLoc),
    });
  }
  return out;
}

const NEAR_SIMILARITY = 0.85;
const MAX_NEAR = 100;

function nearDuplicatesAmong(rules: Rule[]): Finding[] {
  const items = rules
    .map((r) => ({ rule: r, norm: normalizeRuleText(r.text), set: tokenSet(r.text) }))
    .filter((i) => i.norm !== '' && i.set.size >= 3);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length && out.length < MAX_NEAR; i++) {
    for (let j = i + 1; j < items.length && out.length < MAX_NEAR; j++) {
      const a = items[i];
      const b = items[j];
      if (a.norm === b.norm) continue;
      const small = Math.min(a.set.size, b.set.size);
      const large = Math.max(a.set.size, b.set.size);
      if (small / large < NEAR_SIMILARITY) continue;
      const sim = jaccard(a.set, b.set);
      if (sim < NEAR_SIMILARITY) continue;
      const key = [`${a.rule.file}:${a.rule.line}`, `${b.rule.file}:${b.rule.line}`]
        .sort()
        .join('~');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'near-duplicate',
        severity: 'info',
        message: `similar rules (similarity ${sim.toFixed(2)}): "${truncate(a.rule.text, 40)}"`,
        locations: [
          { path: a.rule.file, line: a.rule.line },
          { path: b.rule.file, line: b.rule.line },
        ],
      });
    }
  }
  return out;
}

function looksLikePath(tok: string, backticked: boolean): boolean {
  if (tok === '' || /\s/.test(tok)) return false;
  if (tok.startsWith('-') || tok.startsWith('~') || tok.includes('://')) return false;
  if (/[{}<>$[\]]/.test(tok)) return false;
  const t = tok.replace(/[.,;:!?)]+$/, '');
  if (t === '') return false;
  const trailingSlash = t.endsWith('/');
  const base = trailingSlash ? t.slice(0, -1) : t;
  if (base === '' || base.startsWith('..') || /^[a-zA-Z]:/.test(base)) return false;
  const hasSlash = t.includes('/');
  const ext = /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(base);
  if (backticked) return ext || (hasSlash && trailingSlash);
  return hasSlash && (ext || trailingSlash);
}

function extractPathRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const tok = m[1].trim();
    if (looksLikePath(tok, true)) refs.add(tok);
  }
  for (const m of text.matchAll(/(^|[\s(])([\w.@-]+\/[\w.@*/-]*)(?=[\s.,;:!?)]|$)/g)) {
    const tok = m[2];
    if (looksLikePath(tok, false)) refs.add(tok);
  }
  return [...refs];
}

function globToRegExp(glob: string): RegExp {
  const special = '.^$+()[]{}|\\';
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (special.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function walkAndMatch(
  absDir: string,
  relDir: string,
  rx: RegExp,
  budget: { n: number },
): boolean {
  if (budget.n <= 0) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return false;
  }
  budget.n -= entries.length;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDE_DIRS.includes(entry.name)) continue;
      if (rel.split('/').length > 10) continue;
      if (walkAndMatch(join(absDir, entry.name), rel, rx, budget)) return true;
    } else if (entry.isFile() && rx.test(rel)) {
      return true;
    }
  }
  return false;
}

function pathExists(root: string, ref: string): boolean {
  const clean = ref.replace(/[.,;:!?)]+$/, '').replace(/^\.\//, '');
  if (clean === '' || clean.startsWith('..')) return true;
  const first = clean.split('/')[0];
  if (DEFAULT_EXCLUDE_DIRS.includes(first)) return true;
  if (!/[*?]/.test(clean)) {
    return existsSync(join(root, clean));
  }
  const rx = globToRegExp(clean);
  const dirs = clean.split('/').slice(0, -1);
  const prefix: string[] = [];
  for (const d of dirs) {
    if (d.includes('*') || d.includes('?')) break;
    prefix.push(d);
  }
  const start = join(root, ...prefix);
  if (!existsSync(start)) return false;
  return walkAndMatch(start, prefix.join('/'), rx, { n: 20000 });
}

function deadRefFindings(root: string, rules: Rule[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    for (const ref of extractPathRefs(r.text)) {
      const key = `${r.file}:${r.line}:${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (pathExists(root, ref)) continue;
      out.push({
        kind: 'dead-ref',
        severity: 'error',
        message: `references a path that does not exist: ${ref}`,
        locations: [{ path: r.file, line: r.line }],
      });
    }
  }
  return out;
}

function shadowedFindings(
  agents: AgentModel[],
  loadSets: Map<string, DiscoveredFile[]>,
  parsedByRel: Map<string, ParsedFile>,
): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    const files = loadSets.get(agent.id) ?? [];
    const firstSeen = new Map<string, Location>();
    for (const f of files) {
      const parsed = parsedByRel.get(f.rel);
      if (!parsed) continue;
      for (const r of parsed.rules) {
        const norm = normalizeRuleText(r.text);
        if (norm === '') continue;
        const prev = firstSeen.get(norm);
        if (prev && prev.path !== r.file) {
          const key = [`${prev.path}:${prev.line}`, `${r.file}:${r.line}`].join('~');
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              kind: 'shadowed',
              severity: 'info',
              message: `rule text is shadowed for agent ${agent.id}: "${truncate(r.text, 40)}"`,
              locations: [prev, { path: r.file, line: r.line }],
            });
          }
        }
        if (!prev) firstSeen.set(norm, { path: r.file, line: r.line });
      }
    }
  }
  return out;
}

function agentSummaries(
  agents: AgentModel[],
  discovered: DiscoveredFile[],
  parsedByRel: Map<string, ParsedFile>,
  capOverrides?: Record<string, number>,
): { summaries: AgentSummary[]; findings: Finding[] } {
  const summaries: AgentSummary[] = [];
  const findings: Finding[] = [];
  for (const agent of agents) {
    const files = loadSet(agent, discovered);
    let tokens = 0;
    for (const f of files) tokens += parsedByRel.get(f.rel)?.tokens ?? 0;
    const cap = capFor(agent, capOverrides);
    const locations = files.slice(0, 10).map((f) => ({ path: f.rel, line: 1 }));
    let status: AgentSummary['status'] = 'ok';
    if (tokens > cap) {
      status = 'overflow';
      findings.push({
        kind: 'overflow',
        severity: 'error',
        message: `estimated load for agent ${agent.id} (~${tokens} tokens) exceeds cap ${cap}`,
        locations,
      });
    } else if (tokens >= Math.ceil(cap * 0.8)) {
      status = 'near-cap';
      findings.push({
        kind: 'near-cap',
        severity: 'warn',
        message: `estimated load for agent ${agent.id} (~${tokens} tokens) is at or above 80% of cap ${cap}`,
        locations,
      });
    }
    summaries.push({ id: agent.id, name: agent.name, files: files.map((f) => f.rel), tokens, cap, status });
  }
  return { summaries, findings };
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function sortFindings(findings: Finding[]): void {
  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const la = a.locations[0];
    const lb = b.locations[0];
    if (la && lb && la.path !== lb.path) return la.path < lb.path ? -1 : 1;
    if (la && lb && la.line !== lb.line) return la.line - lb.line;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/** Run all analyses over parsed files and discovered instruction files. */
export function analyze(input: AnalyzeInput): AnalyzeResult {
  const agents = input.agents ?? AGENTS;
  const allRules: Rule[] = input.parsed.flatMap((p) => p.rules);
  const parsedByRel = new Map(input.parsed.map((p) => [p.path, p]));
  const loadSets = new Map<string, DiscoveredFile[]>();
  for (const a of agents) loadSets.set(a.id, loadSet(a, input.discovered));

  const agentRes = agentSummaries(agents, input.discovered, parsedByRel, input.capOverrides);

  const findings: Finding[] = [
    ...conflictsAmong(allRules),
    ...duplicatesAmong(allRules),
    ...nearDuplicatesAmong(allRules),
    ...deadRefFindings(input.root, allRules),
    ...shadowedFindings(agents, loadSets, parsedByRel),
    ...agentRes.findings,
  ];

  sortFindings(findings);
  return { findings, agents: agentRes.summaries };
}