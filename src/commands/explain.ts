/** `rulescope explain`: show one agent's load chain for a repository. */
import { existsSync, readFileSync } from 'node:fs';
import { AGENTS, agentById, loadSet, roleOf } from '../lib/agents.js';
import { discoverInstructionFiles } from '../lib/discover.js';
import { estimateTokens } from '../lib/tokens.js';

export interface ExplainCliOptions {
  depth?: number;
}

export function runExplain(agentId: string, root: string, opts: ExplainCliOptions): number {
  const agent = agentById(agentId);
  if (!agent) {
    console.error(`error: unknown agent: ${agentId}`);
    console.error(`known agents: ${AGENTS.map((a) => a.id).join(', ')}`);
    return 2;
  }
  if (!existsSync(root)) {
    console.error(`error: path does not exist: ${root}`);
    return 2;
  }

  const discovered = discoverInstructionFiles(
    root,
    opts.depth === undefined ? {} : { maxDepth: opts.depth },
  );
  const chain = loadSet(agent, discovered);

  console.log(`agent: ${agent.id} (${agent.name})`);
  console.log(`cap: ~${agent.cap} tokens`);
  if (chain.length === 0) {
    console.log('load chain: (none)');
    return 0;
  }
  console.log('load chain (precedence order):');
  let total = 0;
  for (const f of chain) {
    let content = '';
    try {
      content = readFileSync(f.abs, 'utf8');
    } catch {
      content = '';
    }
    const tokens = estimateTokens(content.length);
    total += tokens;
    console.log(`  ${f.rel}  [${roleOf(f, agent)}]  ~${tokens} t`);
  }
  console.log(`total: ~${total} tokens / cap ~${agent.cap}`);
  return 0;
}