# Publish Sideline on Cloudflare Free

This version runs the shared app on **Cloudflare Workers + D1**. Cloudflare serves the React files, runs the API, and stores accounts/tournaments in its persistent D1 database. No paid Render server, Docker host, or custom domain is required. The public HTTPS address is the actual `workers.dev` URL printed after a successful deployment; this repository does not contain an invented live URL.

The Cloudflare version uses **passkeys** for owner sign-in. Your device provides the normal fingerprint, face, screen-lock, or security-key prompt; passwords from the separate Node/SQLite deployment are not copied to Cloudflare. Match viewers can use their share link without signing in, and editing remains restricted to the tournament owner.

## Easiest: deploy from your Cloudflare dashboard

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/22h-0/football-app-)

While signed into your Cloudflare Free account, open the button above. It uses Cloudflare's official deployment flow for this public repository:

1. Connect/authorize GitHub when Cloudflare asks, and choose the repository/Worker names offered by the setup page. The flow can create a copy of the source in your GitHub account.
2. Keep **Workers Free** and the app's **D1** binding. If build fields are shown, use **Build:** `npm run build:shared` and **Deploy:** `npm run deploy`.
3. Let Cloudflare provision D1 and deploy the app. Open the actual HTTPS URL shown by Cloudflare after the build succeeds.

This dashboard route does **not** require sending an API token to this chat or connecting one to this development environment. Cloudflare provisions the binding itself. The Worker initializes its fixed initial schema on the first API request using idempotent `CREATE ... IF NOT EXISTS` statements. Owner permissions and passkey registration still apply normally; opening the site does not create an owner account automatically.

This is a verified official deployment-button URL and locally validated application/configuration, not a claim that the button has already deployed this user's account. The repository's default branch must contain the Cloudflare version before starting this flow. A successful setup should show the app's real `workers.dev` address; use that address rather than a guessed hostname or an HTML file upload.

The automatic initialization covers only the initial schema. Future database changes that require `ALTER TABLE`, data transformations, or other numbered migrations must be applied explicitly before updating the Worker. For those releases, use the CLI path below or configure the build token with D1 edit permission and apply migrations as part of deployment.

## Alternative: let this environment deploy through the CLI

Signing into the Cloudflare website authenticates that browser. To publish from this development environment, connect a Cloudflare API token through **environment settings**, never through chat or a source file:

1. In Cloudflare, open **My Profile → API Tokens → Create Token**. Start with **Edit Cloudflare Workers** and include **Account → D1 → Edit**, **Account → Workers Scripts → Edit**, and **Account → Account Settings → Read** for the account that will own Sideline. Extra zone permissions are unnecessary for a `workers.dev` site.
2. Save the token securely as `CLOUDFLARE_API_TOKEN` in this environment's secret settings, permitted only for HTTPS requests to `api.cloudflare.com`. A connected proxy can provide a placeholder that it replaces securely; do not copy the value into scripts or configuration.
3. If your token can see more than one account, set the non-secret `CLOUDFLARE_ACCOUNT_ID` to the intended account's ID. For a single accessible account, the helper discovers it. Apply the environment settings so the terminal can use the binding.

If deploying from your own computer instead, `npx wrangler login` can use Cloudflare's browser/OAuth flow. A saved Wrangler login also works with the helper. Never run an authentication command that prints a token to share it in chat.

### Run the CLI deployment

Use Node.js 24 and this repository's lockfile:

```sh
npm ci
node scripts/deploy-cloudflare.mjs --dry-run
node scripts/deploy-cloudflare.mjs
```

The helper:

1. Resolves the selected Cloudflare account without printing credentials.
2. Reuses the configured `sideline` D1 database, or creates it if absent. It refuses to silently replace an existing database binding or switch accounts.
3. Saves the real, non-secret account/database IDs in `wrangler.jsonc`.
4. Applies pending SQL migrations from `cloudflare/migrations` **before** publishing the Worker. A failed migration stops publication.
5. Runs Wrangler, which builds with `npm run build:shared` and deploys the API and assets together.

The helper's `--dry-run` prints this plan only: it makes no Cloudflare requests and changes no files. It is not a bundling test or a live deployment. To check the Worker bundle separately without publication, use `npx wrangler deploy --dry-run`.

The deployment helper does not subscribe to Workers Paid, enable paid products, or call subscription APIs. Keep the account on **Workers Free**. This configuration has no CPU limit override or paid-only service binding. Normal resource creation and migrations still affect the selected account, so use the intended account and retain its real D1 ID for subsequent releases.

Cloudflare's current Wrangler can also automatically provision D1 when `database_id` is omitted. This configuration deliberately omits fake UUIDs. The helper explicitly resolves/creates the database first so its schema exists before the API is published. `wrangler d1 create` does not support `--json`; the helper gets the actual UUID from `wrangler d1 list --json` instead.

Keep `wrangler.jsonc` valid JSON when using the helper. It updates that file atomically with real IDs; it never stores API tokens. Wrangler itself supports JSONC comments, but this small helper deliberately reads JSON syntax. Preserve the saved IDs between deployments so existing accounts and tournaments stay in the same database.

## Check the real site

After Wrangler prints a successful deployment and its HTTPS URL:

- Open that exact URL on a passkey-capable browser/device. Register an owner account and finish the device prompt.
- Create a tournament, update a fixture and goalscorers, then reopen the tournament to verify the saved result.
- Open the viewer link in a signed-out/private browser. Confirm results and standings appear, then verify editing is unavailable. Keep that page open while changing a result as the owner to check live refresh.
- Reload the owner page and confirm the session and saved tournament remain available.
- Open `/api/session`: the API should return JSON, including the authentication mode, rather than the React HTML shell.

A local build, saved configuration, plan-only dry run, and successful upload are separate from these browser checks. Passkeys and secure cookies require HTTPS in production; localhost is supported for development. Passkeys are tied to the site's hostname, so decide on the long-term hostname before relying on accounts. Moving to a different hostname can require registering new credentials.

## Local Worker development

The local D1 database is independent of the remote database:

```sh
npm run build:shared
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Wrangler stores local state under `.wrangler/`. Keep that directory and `.dev.vars` files out of Git. Do not delete the remote database to reset local tests. The root app, `/watch/...` viewer pages, JavaScript, CSS, and icons use static-asset routing; `/api` and `/api/*` always run the Worker. Deep viewer links receive the React shell instead of a static-host 404.

## Automatic deploys from GitHub

After a first authenticated CLI deployment has saved the real D1 ID, you can optionally connect this GitHub repository to the existing Worker through **Workers & Pages → your Worker → Settings → Builds**. Choose the intended branch, retain the same Worker name/database binding, and use:

- Build command: `npm run build:shared`
- Deploy command: `node scripts/deploy-cloudflare.mjs`

The helper safely reapplies only pending migrations and reuses the same database. The build's Cloudflare token needs D1 edit access as well as Worker deployment access. Keep token values in Cloudflare's secure build settings. Cloudflare dashboard deployments can auto-provision bindings without IDs, but the generated IDs are not automatically committed back to Git; retaining the real ID avoids accidentally starting with an empty database on a later setup.

Git integration is optional. The direct CLI workflow above does not require granting Cloudflare access to GitHub. The official button is an alternative flow that connects GitHub inside Cloudflare's dashboard; these instructions do not assume that connection already exists.

## Free limits and data retention

Cloudflare currently documents these **Free** limits:

| Resource | Included limit |
| --- | --- |
| Static asset requests | Free and unlimited |
| Requests invoking Worker API code | 100,000 per day |
| Worker CPU time | 10 ms per HTTP request |
| D1 database count | 10 per account |
| D1 storage | 500 MB per database; 5 GB total per account |
| D1 rows read | 5 million per day |
| D1 rows written | 100,000 per day |
| D1 point-in-time recovery | 7 days |

HTML and bundled assets bypass Worker execution; API polling and writes consume the request and D1 quotas. D1 counts rows scanned, not just rows returned, and index updates also count as writes. Free daily quotas reset at 00:00 UTC. If free limits are exhausted, requests can fail until the quota resets; the configuration does not upgrade the account automatically. Check Cloudflare's dashboard metrics and current published limits before depending on a particular traffic level.

The browser roster still lives in LocalStorage. Shared owner accounts and tournaments live in D1. Neither the Node version's `sideline.sqlite` file nor existing LocalStorage data is automatically transferred into the new remote database. Use the app's supported import flow when available; do not upload a database containing private credentials as a static asset.

One scheduled cleanup runs daily at 03:00 UTC to remove expired authentication state. It uses one of the five Cron Triggers included on Workers Free and does not enable a paid scheduler.

For an additional backup, export D1 to a private location before schema-changing updates:

```sh
npx wrangler d1 export DB --remote --output=/path/to/private-backups/sideline.sql
```

The SQL export contains account and tournament data. Protect it, keep it outside the public assets/repository, and test restoration independently. Do not delete/recreate D1 as part of an application update.

## Official references

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static asset routing and billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Official Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

The limits and configuration behavior above were checked against Cloudflare's official documentation source on November 9, 2026. Hosting-provider limits can change. This guide and configuration do not establish that this particular account has been connected or that a public deployment has completed.
