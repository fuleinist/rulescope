/** `rulescope scan`: discover, parse, analyze, and report. */
import { existsSync, readFileSync } from 'node:fs';
import { agentsFor } from '../lib/agents.js';
import { analyze } from '../lib/analyze.js';
import { discoverInstructionFiles } from '../lib/discover.js';
import { parseInstructionFile } from '../lib/parse.js';
import {
  computeExitCode,
  renderJson,
  renderText,
  type FileSummary,
  type ScanResult,
} from '../lib/report.js';

export interface ScanCliOptions {
  json: boolean;
  strict: boolean;
  caps: Record<string, number>;
  depth?: number;
}

export function runScan(root: string, opts: ScanCliOptions): number {
  if (!existsSync(root)) {
    console.error(`error: path does not exist: ${root}`);
    return 2;
  }

  const discovered = discoverInstructionFiles(
    root,
    opts.depth === undefined ? {} : { maxDepth: opts.depth },
  );

  const parsed = discovered.map((f) => {
    let content = '';
    try {
      content = readFileSync(f.abs, 'utf8');
    } catch {
      content = '';
    }
    return parseInstructionFile(f.rel, content);
  });

  const { findings, agents } = analyze({
    root,
    discovered,
    parsed,
    capOverrides: opts.caps,
  });

  const files: FileSummary[] = discovered.map((f, i) => ({
    path: f.rel,
    kind: f.kind,
    rules: parsed[i].rules.length,
    chars: parsed[i].chars,
    tokens: parsed[i].tokens,
    agents: agentsFor(f.kind),
  }));

  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const f of findings) {
    if (f.severity === 'error') summary.errors += 1;
    else if (f.severity === 'warn') summary.warnings += 1;
    else summary.infos += 1;
  }

  const result: ScanResult = { root, files, agents, findings, summary };
  const text = opts.json
    ? renderJson(result, { strict: opts.strict })
    : renderText(result, { strict: opts.strict });
  console.log(text);
  return computeExitCode(result, opts.strict);
}