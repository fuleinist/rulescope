#!/usr/bin/env node
/** rulescope CLI entry point. */
import { parseCliArgs } from './lib/args.js';
import { runExplain } from './commands/explain.js';
import { runScan } from './commands/scan.js';

const USAGE = `rulescope - x-ray tool for AI instruction files

Usage:
  rulescope scan [path] [--json] [--strict] [--cap agent=number] [--depth n]
  rulescope explain <agent> [path]

Commands:
  scan     Scan a repo and report what each agent loads
  explain  Show one agent's load chain for a repo

Exit codes:
  0 clean, 1 findings, 2 usage error
`;

function main(): number {
  const argv = process.argv.slice(2);
  const args = parseCliArgs(argv);

  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(`error: ${e}`);
    console.error('');
    console.error(USAGE);
    return 2;
  }

  if (args.options.help) {
    console.log(USAGE);
    return 0;
  }

  const cmd = args.command;
  if (!cmd) {
    console.log(USAGE);
    return 2;
  }

  if (cmd === 'scan') {
    const path = args.options.positionals[0] ?? '.';
    return runScan(path, {
      json: args.options.json,
      strict: args.options.strict,
      caps: args.options.caps,
      depth: args.options.depth,
    });
  }

  if (cmd === 'explain') {
    const agentId = args.options.positionals[0];
    if (!agentId) {
      console.error('error: explain needs an agent id');
      console.error('');
      console.error(USAGE);
      return 2;
    }
    const path = args.options.positionals[1] ?? '.';
    return runExplain(agentId, path, { depth: args.options.depth });
  }

  console.error(`error: unknown command: ${cmd}`);
  console.error('');
  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}