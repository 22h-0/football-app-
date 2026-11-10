import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(projectRoot, 'wrangler.jsonc');
const accountPattern = /^[a-f\d]{32}$/i;
const databasePattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function chooseAccount(config, environment, identity) {
  const configured = config.account_id;
  const injected = environment.CLOUDFLARE_ACCOUNT_ID;
  if (configured && injected && configured !== injected) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID conflicts with the saved account_id. Select the same account before deploying.');
  }
  const accounts = identity?.accounts ?? [];
  const accountId = injected || configured || (accounts.length === 1 ? accounts[0].id : undefined);
  if (!accountId) {
    throw new Error('Choose the target Cloudflare account by setting the non-secret CLOUDFLARE_ACCOUNT_ID in environment settings.');
  }
  if (!accountPattern.test(accountId)) throw new Error('The Cloudflare account ID must contain 32 hexadecimal characters.');
  return accountId;
}

export function chooseDatabase(binding, databases) {
  if (!Array.isArray(databases)) throw new Error('Wrangler did not return a database list. No resources were changed.');
  if (binding.database_id) {
    const existing = databases.find((database) => database.uuid === binding.database_id);
    if (!existing || existing.name !== binding.database_name) {
      throw new Error('The saved database_id does not match this database name in the selected account. The binding was preserved; no replacement database was created.');
    }
    return existing;
  }
  const matches = databases.filter((database) => database.name === binding.database_name);
  if (matches.length > 1) throw new Error('More than one database matches this name. Select its database_id explicitly.');
  return matches[0] ?? null;
}

function redact(text, environment) {
  const token = environment.CLOUDFLARE_API_TOKEN;
  return token ? String(text ?? '').split(token).join('[redacted]') : String(text ?? '');
}

function wranglerRunner(environment) {
  const cli = path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js');
  if (!existsSync(cli)) throw new Error('Wrangler is missing. Run npm ci before deploying.');
  return (arguments_, { json = false } = {}) => {
    const result = spawnSync(process.execPath, [cli, ...arguments_, '--config', configPath], {
      cwd: projectRoot,
      env: {
        ...environment,
        CI: 'true',
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: environment.WRANGLER_LOG_PATH || path.join(projectRoot, '.wrangler/logs/deploy.log'),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180_000,
    });
    if (result.error || result.status !== 0) {
      // whoami can contain personal metadata. Its raw output is never shown.
      const detail = arguments_[0] === 'whoami' ? '' : redact(result.stderr, environment).trim();
      throw new Error(`Wrangler ${arguments_.slice(0, 2).join(' ')} failed${detail ? `: ${detail}` : '. Check Cloudflare authentication and account access.'}`);
    }
    if (json) {
      try { return JSON.parse(result.stdout); }
      catch { throw new Error('Wrangler returned unexpected JSON. No additional deployment steps were attempted.'); }
    }
    if (result.stdout) process.stdout.write(redact(result.stdout, environment));
    if (result.stderr) process.stderr.write(redact(result.stderr, environment));
    return result.stdout;
  };
}

function accountIdentityFromToken(environment) {
  // The minimal deployment token can list accounts without permission to read
  // personal /user details. Native Node 24 proxy support preserves the same
  // HTTPS proxy and CA trust used by this environment; no direct-network route
  // or copied credential file is needed. Only account IDs cross stdout.
  const source = `
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
        headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
        signal: AbortSignal.timeout(15000)
      });
      const body = await response.json();
      if (!response.ok || body.success === false || !Array.isArray(body.result)) process.exitCode = 1;
      else process.stdout.write(JSON.stringify({ accounts: body.result.map(({ id }) => ({ id })) }));
    } catch { process.exitCode = 1; }
  `;
  const result = spawnSync(process.execPath, ['--use-env-proxy', '--input-type=module', '-e', source], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Cloudflare account discovery failed. Check API access/token permissions, or set the non-secret CLOUDFLARE_ACCOUNT_ID to select the account explicitly.');
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Cloudflare returned an unexpected account list. Set the non-secret CLOUDFLARE_ACCOUNT_ID explicitly.'); }
}

/** An injectable runner lets tests verify ordering without creating resources. */
export function prepareAndDeploy({ config, environment, run, saveConfig, identify, log = console.log }) {
  const binding = config.d1_databases?.find((database) => database.binding === 'DB');
  if (!binding?.database_name) throw new Error('Configure the DB binding and database_name in wrangler.jsonc first.');
  let identity;
  if (!environment.CLOUDFLARE_ACCOUNT_ID && !config.account_id) {
    identity = identify ? identify() : run(['whoami', '--json'], { json: true });
  }
  const accountId = chooseAccount(config, environment, identity);
  // All following Wrangler invocations see this selected account, including
  // the first database list before account_id is saved in the config.
  environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  let databases = run(['d1', 'list', '--json'], { json: true });
  let database = chooseDatabase(binding, databases);
  if (!database) {
    log(`Creating D1 database '${binding.database_name}' in the selected account.`);
    // create has no --json flag. Suppress config auto-edits, then get the real
    // identifier from the official machine-readable list instead of a regex.
    run(['d1', 'create', binding.database_name, '--update-config=false']);
    databases = run(['d1', 'list', '--json'], { json: true });
    database = chooseDatabase(binding, databases);
    if (!database) throw new Error('The database was created but its ID could not be resolved. Retry; no second database will be created with the same name.');
  } else {
    log(`Reusing D1 database '${binding.database_name}'.`);
  }
  if (!databasePattern.test(database.uuid)) throw new Error('Cloudflare returned an invalid database identifier; deployment stopped.');
  config.account_id = accountId;
  binding.database_id = database.uuid;
  saveConfig(config);
  log('Applying pending migrations before publishing the Worker. Existing data is retained.');
  run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  log('Building and publishing the shared app. This does not change your Cloudflare subscription.');
  run(['deploy']);
  log('Deployment command completed. Use the actual HTTPS URL printed by Wrangler and verify sign-in, tournament updates, and a signed-out viewer.');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/deploy-cloudflare.mjs [--dry-run]\nReuses/creates D1, records its real ID, applies migrations, then deploys the shared Worker.\n--dry-run prints the plan without contacting Cloudflare or changing files.');
    return;
  }
  if (args.some((argument) => argument !== '--dry-run')) throw new Error('Unknown argument. Use --help for supported options.');
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch { throw new Error('The deployment helper expects valid JSON in wrangler.jsonc. Keep this generated configuration free of comments and trailing commas, or use Wrangler directly.'); }
  if (args.includes('--dry-run')) {
    console.log('Plan only: resolve the Cloudflare account; reuse or create the configured D1 database; save real resource IDs; apply remote migrations; build:shared; deploy.\nNo Cloudflare requests, file changes, resource creation, subscription changes, or publication performed.');
    return;
  }
  const binding = config.d1_databases?.find((database) => database.binding === 'DB');
  if (!existsSync(path.resolve(projectRoot, config.main ?? ''))) throw new Error('The configured Worker entrypoint is missing.');
  if (!binding?.migrations_dir || !existsSync(path.resolve(projectRoot, binding.migrations_dir))) throw new Error('The D1 migrations directory is missing.');
  const environment = { ...process.env };
  if (environment.CLOUDFLARE_API_TOKEN && !environment.XDG_CONFIG_HOME) environment.XDG_CONFIG_HOME = path.join(projectRoot, '.wrangler/config');
  if (!environment.CLOUDFLARE_API_TOKEN && !config.account_id && !environment.CLOUDFLARE_ACCOUNT_ID) {
    // A locally saved Wrangler OAuth login is also supported by whoami.
    console.log('Using an existing Wrangler login if available. Cloudflare dashboard sign-in alone does not authenticate this terminal.');
  }
  mkdirSync(path.join(projectRoot, '.wrangler/logs'), { recursive: true });
  const run = wranglerRunner(environment);
  prepareAndDeploy({
    config,
    environment,
    run,
    identify: environment.CLOUDFLARE_API_TOKEN ? () => accountIdentityFromToken(environment) : undefined,
    saveConfig(next) {
      const temporary = `${configPath}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
      renameSync(temporary, configPath);
    },
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) { console.error(redact(`Cloudflare deployment stopped: ${error.message}`, process.env)); process.exitCode = 1; }
}
