/** Command line parsing for the rulescope CLI. */

export interface CliOptions {
  json: boolean;
  strict: boolean;
  help: boolean;
  caps: Record<string, number>;
  depth?: number;
  positionals: string[];
}

export interface CliArgs {
  command: string | undefined;
  options: CliOptions;
  errors: string[];
}

function applyCap(raw: string, options: CliOptions, errors: string[]): void {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    errors.push(`invalid --cap value: ${raw} (expected agent=number)`);
    return;
  }
  const agent = raw.slice(0, eq).trim();
  const value = Number(raw.slice(eq + 1));
  if (!/^[a-z-]+$/i.test(agent) || !Number.isFinite(value) || value <= 0) {
    errors.push(`invalid --cap value: ${raw} (expected agent=number)`);
    return;
  }
  options.caps[agent] = value;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const options: CliOptions = {
    json: false,
    strict: false,
    help: false,
    caps: {},
    positionals: [],
  };
  const errors: string[] = [];
  let command: string | undefined;
  let i = 0;

  const readValue = (name: string): string | undefined => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      errors.push(`missing value for ${name}`);
      return undefined;
    }
    i += 1;
    return v;
  };

  while (i < argv.length) {
    const tok = argv[i];
    if (tok === '--json') {
      options.json = true;
    } else if (tok === '--strict') {
      options.strict = true;
    } else if (tok === '--help' || tok === '-h') {
      options.help = true;
    } else if (tok === '--cap' || tok.startsWith('--cap=')) {
      const raw = tok.startsWith('--cap=') ? tok.slice('--cap='.length) : readValue('--cap');
      if (raw !== undefined) applyCap(raw, options, errors);
    } else if (tok === '--depth' || tok.startsWith('--depth=')) {
      const raw = tok.startsWith('--depth=') ? tok.slice('--depth='.length) : readValue('--depth');
      if (raw !== undefined) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) errors.push(`invalid --depth value: ${raw}`);
        else options.depth = n;
      }
    } else if (tok.startsWith('-')) {
      errors.push(`unknown option: ${tok}`);
    } else if (command === undefined) {
      command = tok;
    } else {
      options.positionals.push(tok);
    }
    i += 1;
  }

  return { command, options, errors };
}