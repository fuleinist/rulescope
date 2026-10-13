# SPEC — rulescope v0.1.0

## Problem

AI coding agents each load their own set of instruction files: CLAUDE.md,
AGENTS.md, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, GEMINI.md,
`.clinerules`, `.windsurf/rules`. Support and precedence differ per tool and are
poorly documented. Nothing audits what actually takes effect.

Developers keep asking: **what rules does each agent really read, and where do
they contradict each other?** rulescope is an x-ray tool for that question. It
scans a repository, models the file set each agent loads, and reports conflicts,
duplicates, dead rules, and context-cap overflows.

## Users

Developers and teams that run more than one coding agent in the same repository.

## Scope (v0.1.0)

### 1. `rulescope scan [path]`

Scan a repository. Default path: current directory.

Steps:

1. Discover instruction files across known locations (see agent models below).
2. Parse each file into rules. A **rule** is:
   - a list item (bullet `-`, `*`, `+`, or numbered `1.` style), including its
     wrapped continuation lines; or
   - a standalone non-empty paragraph block.
   Rules inside fenced code blocks and YAML frontmatter are ignored.
   Each rule records: file, line number, heading path, raw text.
3. Estimate tokens: `ceil(chars / 4)` per file and per agent total.
   This is a documented approximation, not a real tokenizer.
4. For each agent (see models), assemble the load set for the repository root:
   files that exist, in precedence order.
5. Analyze (see findings below). Report per file, per agent, and findings.

Options:

- `--json` prints machine-readable JSON.
- `--strict` fails (exit 1) on warnings too. Default: errors only.
- `--cap <agent=number>` override a token cap. Repeatable.
- `--depth <n>` max directory depth for nested file discovery (default 6).

### 2. `rulescope explain <agent>`

Print the load chain for one agent: each file in precedence order, its size,
token estimate, and role (primary, nested, rules-dir, fallback). Exit 0.

### 3. Agent models (data-driven, documented as approximations)

v0.1 models, based on public docs as of Oct 2026. Each model lists candidate
files/globs and a precedence order. Roots first; nested files load when the
agent works inside that subtree.

- `claude` (Claude Code): `CLAUDE.md` (root + nested), `.claude/rules/**/*.md`,
  `AGENTS.md` fallback. Precedence: CLAUDE.md → .claude/rules → AGENTS.md.
- `codex`: `AGENTS.md` (root + nested). Precedence: root → nested.
- `cursor`: `.cursor/rules/**/*.mdc`, then legacy `.cursorrules`.
- `copilot`: `.github/copilot-instructions.md`, then
  `.github/instructions/**/*.instructions.md` (path-scoped).
- `gemini`: `GEMINI.md` (root + nested).
- `cline`: `.clinerules` (file or directory `**/*.md`).
- `windsurf`: `.windsurf/rules/**/*.md`, then legacy `.windsurfrules`.

Default token caps (approximate; override with `--cap`):
default 6000; claude 8000; copilot 4000; others 6000.

### 4. Findings

Severity levels: `error`, `warn`, `info`.

- `conflict` (error): two rules contain opposite markers from an antonym list
  AND share at least one topic token (length >= 4, not a stopword, not part of
  the antonym markers). Antonym marker pairs (v0.1):
  tabs/spaces, single-quote/double-quote, always/never, must/must not,
  use/avoid, include/exclude.
- `duplicate` (warn): identical normalized rule text appears twice (same file
  or across files). Normalization: lowercase, collapse whitespace, strip
  punctuation and backticks. Report both locations.
- `near-duplicate` (info): token-set Jaccard similarity >= 0.85 between two
  rules but not exact duplicates.
- `dead-ref` (warn): a rule references a path that does not exist relative to
  the repo root. Path-like token = contains `/` and matches a file-ish pattern
  (known extension or trailing `/`), or is backticked with an extension.
  Globs are expanded with a simple `*` matcher. Conservative: skip bare words.
- `shadowed` (info): a rule's normalized text also appears in a
  higher-precedence file for the same agent. Report the losing location.
- `overflow` (error): an agent's total estimated tokens exceed its cap.
  `near-cap` (warn): above 80% of the cap.

### 5. Output

Text report sections: header summary (files, rules, tokens), FILES, AGENT
MATRIX, FINDINGS (grouped by severity, with `file:line` references), summary
counts. Example header:

```
rulescope — 12 files, 184 rules, ~5,350 tokens
```

Exit codes: `0` clean, `1` findings at or above the failure threshold,
`2` usage error. Failure threshold: errors (default) or errors+warnings with
`--strict`.

### 6. JSON shape (v0.1)

```json
{
  "root": ".",
  "files": [{ "path": "AGENTS.md", "rules": 12, "chars": 4200, "tokens": 1050, "agents": ["codex"] }],
  "agents": [{ "id": "claude", "files": ["CLAUDE.md"], "tokens": 1800, "cap": 8000, "status": "ok" }],
  "findings": [{ "kind": "duplicate", "severity": "warn", "message": "...", "locations": [{ "path": "AGENTS.md", "line": 12 }] }],
  "summary": { "errors": 1, "warnings": 3, "infos": 2, "exitCode": 1 }
}
```

## Architecture

- TypeScript, zero runtime dependencies. Node 20 or newer.
- `tsc` build to `dist/`. Tests with `node:test` against `dist/` or src via tsx-free setup (compile first).
- Modules: `src/cli.ts`, `src/discover.ts`, `src/parse.ts`, `src/agents.ts`,
  `src/analyze.ts`, `src/tokens.ts`, `src/report.ts`.
- `bin` entry: `rulescope` → `dist/src/cli.js` with Node shebang (tsc writes to `dist/src`, matching the sibling repo layout).

## Acceptance criteria

- `npm run build` completes with no TypeScript errors.
- `npm test` passes: covers parse (list + paragraph + fences + frontmatter),
  discovery, agent load sets, each finding kind, and text/JSON output.
- `node dist/src/cli.js scan test/fixtures/conflict` exits 1 and reports at least
  one `conflict` error.
- `node dist/src/cli.js scan test/fixtures/clean` exits 0 with zero findings.
- `node dist/src/cli.js scan test/fixtures/dead` exits 1 and reports the missing
  path reference. A negative control (path that exists) produces no finding.
- A fixture with a low `--cap` produces `overflow`.
- Duplicate detection uses a negative control pair that must NOT match.
- `--json` output parses as JSON and matches the shape above.
- `package.json` has zero runtime dependencies. MIT license. README documents
  commands, exit codes, and states that agent models are approximations.
- `explain codex` prints its load chain on a fixture repo.

## Max scope — will NOT do (v0.1.0)

- No config generation, syncing, or rewriting of instruction files.
- No network access, no GitHub API calls.
- No custom config file (only `--cap`/`--depth` flags).
- No editor plugins, no watch mode, no CI action.
- No exact tokenizer; chars/4 estimate only, documented as such.

## Exit conditions

Spec met + tests green → update idea queue, commit and push. If a cycle stalls
twice on the same gap, record it in NOTES.md and continue with the next area.