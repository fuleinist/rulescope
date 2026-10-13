/** Text and JSON report rendering for scan results. */
import type { AgentSummary, Finding } from './analyze.js';
import type { InstructionKind } from './discover.js';
import { formatNumber } from './util.js';

export interface FileSummary {
  path: string;
  kind: InstructionKind;
  rules: number;
  chars: number;
  tokens: number;
  agents: string[];
}

export interface ScanResult {
  root: string;
  files: FileSummary[];
  agents: AgentSummary[];
  findings: Finding[];
  summary: { errors: number; warnings: number; infos: number };
}

/** Exit code: 1 when errors exist, or warnings in strict mode. */
export function computeExitCode(result: ScanResult, strict: boolean): number {
  if (result.summary.errors > 0) return 1;
  if (strict && result.summary.warnings > 0) return 1;
  return 0;
}

/** Render the human-readable report. */
export function renderText(result: ScanResult, opts: { strict?: boolean } = {}): string {
  const strict = opts.strict ?? false;
  const lines: string[] = [];
  const totalRules = result.files.reduce((n, f) => n + f.rules, 0);
  const totalTokens = result.files.reduce((n, f) => n + f.tokens, 0);
  lines.push(
    `rulescope - ${result.files.length} files, ${totalRules} rules, ~${formatNumber(totalTokens)} tokens`,
  );
  lines.push(`root: ${result.root}`);
  lines.push('');
  lines.push('FILES');
  if (result.files.length === 0) {
    lines.push('  (none)');
  } else {
    const width = Math.min(60, Math.max(20, ...result.files.map((f) => f.path.length))) + 1;
    for (const f of result.files) {
      lines.push(
        `  ${f.path.padEnd(width)} ${f.rules} rules  ~${formatNumber(f.tokens)} t  [${f.agents.join(', ')}]`,
      );
    }
  }
  lines.push('');
  lines.push('AGENT MATRIX');
  for (const a of result.agents) {
    const n = a.files.length;
    const status = a.status === 'ok' ? 'ok' : a.status.toUpperCase();
    lines.push(
      `  ${a.id.padEnd(9)} ${n} file${n === 1 ? '' : 's'}  ~${formatNumber(a.tokens)} t / ${formatNumber(a.cap)}  ${status}`,
    );
  }
  lines.push('');
  const s = result.summary;
  lines.push(`FINDINGS (${s.errors} errors, ${s.warnings} warnings, ${s.infos} infos)`);
  if (result.findings.length === 0) {
    lines.push('  none');
  }
  for (const f of result.findings) {
    const locs = f.locations.map((l) => `${l.path}:${l.line}`).join(', ');
    lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${f.kind.padEnd(14)} ${f.message}${locs ? ` (${locs})` : ''}`);
  }
  lines.push('');
  lines.push(`summary: ${s.errors} errors, ${s.warnings} warnings, ${s.infos} infos - exit ${computeExitCode(result, strict)}`);
  return lines.join('\n');
}

/** Render the machine-readable JSON report. */
export function renderJson(result: ScanResult, opts: { strict?: boolean } = {}): string {
  const strict = opts.strict ?? false;
  const out = {
    root: result.root,
    files: result.files,
    agents: result.agents.map((a) => ({
      id: a.id,
      name: a.name,
      files: a.files,
      tokens: a.tokens,
      cap: a.cap,
      status: a.status,
    })),
    findings: result.findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      message: f.message,
      locations: f.locations,
    })),
    summary: { ...result.summary, exitCode: computeExitCode(result, strict) },
  };
  return JSON.stringify(out, null, 2);
}