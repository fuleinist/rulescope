# rulescope

> X-ray tool for AI instruction files: see what rules each coding agent loads.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Coding agents each read their own instruction files. Claude Code reads `CLAUDE.md`.
Codex reads `AGENTS.md`. Cursor reads `.cursor/rules/*.mdc`. Support and precedence
differ per tool. So developers ask: what does each agent really read?

rulescope scans a repository and answers that question. It reports conflicts,
duplicates, dead rules, and context-cap overflows.

Zero runtime dependencies. Node 20 or newer.

## Quick start

```bash
npm install
npm run build

node dist/src/cli.js scan .            # scan the current repo
node dist/src/cli.js scan repo --json  # machine-readable output
node dist/src/cli.js explain claude    # one agent's load chain
```

## Commands

### `scan [path]`

Scan a repository. The default path is the current directory.

```bash
rulescope scan
rulescope scan path/to/repo
rulescope scan --json
rulescope scan --strict
rulescope scan --cap copilot=2000
rulescope scan --depth 3
```

- `--json` prints machine-readable output.
- `--strict` fails on warnings too.
- `--cap <agent=number>` overrides a token cap. The flag is repeatable.
- `--depth <n>` limits the directory depth for nested files. Default: 6.

### `explain <agent>`

Print one agent's load chain for a repository.

```bash
rulescope explain claude
rulescope explain codex path/to/repo
```

## Exit codes

- `0` clean
- `1` findings at the failure threshold. The threshold is errors. With `--strict` it includes warnings.
- `2` usage error

## What it finds

- `conflict` (error): two rules use opposite markers and discuss the same topic.
- `duplicate` (warn): the same rule text appears twice.
- `near-duplicate` (info): two rules are 85% or more similar.
- `dead-ref` (error): a rule references a path that does not exist.
- `shadowed` (info): a lower-precedence copy of a rule is shadowed for one agent.
- `overflow` (error): an agent's estimated load exceeds its token cap.
- `near-cap` (warn): an agent's estimated load is at or above 80% of its cap.

## Agent models

The v0.1 models are approximations based on public docs (October 2026).
Nested files load when the agent works inside that subtree.

| Agent    | Reads                                                        | Cap estimate |
| -------- | ------------------------------------------------------------ | ------------ |
| claude   | `CLAUDE.md` (root and nested), `.claude/rules/**/*.md`, `AGENTS.md` fallback | 8,000 tokens |
| codex    | `AGENTS.md` (root and nested)                                | 6,000 tokens |
| cursor   | `.cursor/rules/**/*.mdc`, `.cursorrules`                     | 6,000 tokens |
| copilot  | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` | 4,000 tokens |
| gemini   | `GEMINI.md` (root and nested)                                | 6,000 tokens |
| cline    | `.clinerules`, `.clinerules/**/*.md`                         | 6,000 tokens |
| windsurf | `.windsurf/rules/**/*.md`, `.windsurfrules`                  | 6,000 tokens |

Token counts use a `chars / 4` estimate. This is not a real tokenizer.
Override any cap with `--cap`.

## JSON output

```json
{
  "root": ".",
  "files": [
    {
      "path": "AGENTS.md",
      "kind": "agents-md",
      "rules": 12,
      "chars": 4200,
      "tokens": 1050,
      "agents": ["claude", "codex"]
    }
  ],
  "agents": [
    {
      "id": "claude",
      "name": "Claude Code",
      "files": ["CLAUDE.md"],
      "tokens": 1800,
      "cap": 8000,
      "status": "ok"
    }
  ],
  "findings": [
    {
      "kind": "duplicate",
      "severity": "warn",
      "message": "duplicate rule text (2 occurrences): \"...\"",
      "locations": [{ "path": "AGENTS.md", "line": 12 }]
    }
  ],
  "summary": { "errors": 0, "warnings": 2, "infos": 1, "exitCode": 0 }
}
```

## How it works

1. Discovery walks the repository and finds known instruction files.
2. Parsing turns each file into rules. A rule is a list item or a paragraph.
3. Analysis runs the checks and builds per-agent load sets.
4. Reporting prints the text report or the JSON report.

Rules inside code fences, frontmatter, comments, and tables are ignored.

## Limitations

- Conflict detection is heuristic. It uses a small list of marker pairs.
- Dead-reference checks accept file-like tokens with a slash and an extension. They are conservative by design.
- Precedence handling for nested files is simplified.
- Use the npm test script for tests. It passes the quoted test glob, which Windows shells need.

## Development

```bash
npm install
npm run build          # tsc to dist/
npm test               # builds, then runs node --test on dist/test
```

Test fixtures live under `test/fixtures/`. Each fixture is a small sample repo.

## License

MIT