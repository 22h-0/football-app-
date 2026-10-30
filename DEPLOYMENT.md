# Publish Sideline

Sideline runs as one Node.js 24 service: Express serves both the built React app and its API. Run it behind HTTPS with persistent storage. Static-only hosting cannot provide accounts, owner-only editing, or live public tournament links.

## Local development

Use Node.js 24. Install dependencies with `npm ci`, then start the API and shared frontend in separate terminals:

```sh
# Terminal 1
npm run dev:server
```

```sh
# Terminal 2
npm run dev:shared
```

Use development mode for local HTTP testing; production sessions require HTTPS. The default `npm run dev` and `npm run build` retain browser-local mode. Opening the standalone HTML export does not start a shared server or provide online updates.

## Docker on your server

The Dockerfile builds the shared frontend separately, installs production runtime dependencies, runs as the unprivileged `node` user, and checks `GET /api/session` for readiness. It listens on container port 3001. Docker and Docker Compose v2 must already be installed on the host.

1. Copy this repository to your server. Create an untracked `.env` file beside `compose.yaml` with your actual public origin:

   ```dotenv
   APP_ORIGIN=https://football.example.com
   ```

   Replace the example hostname with a domain you control. Use the exact HTTPS scheme and hostname, without a path or trailing slash. Do not include passwords, existing databases, or session cookies in the image.

2. Build and start:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 sideline
   ```

3. Point the domain's DNS at your host. Configure a reverse proxy with a valid HTTPS certificate to forward that hostname to `127.0.0.1:3001`, preserving the Host header. The Compose port is bound to loopback; a proxy in another container must instead reach the service over an appropriate shared Docker network. Secure cookies are enabled in production mode without trusting client-supplied forwarding headers.

   Example Caddy configuration when Caddy runs on the host:

   ```caddyfile
   football.example.com {
       reverse_proxy 127.0.0.1:3001
   }
   ```

4. Open the actual HTTPS origin. Register an owner account, create a tournament, and open its viewer link in a separate signed-out/private browser. Confirm the viewer sees updates but cannot edit results, teams, goals, or settings. Production sign-in requires HTTPS; the raw HTTP backend port is not a production login URL.

These files do not provision or publish a website. An actual hosting account, domain/TLS setup, and deployment are still required. No public URL has been created or verified by preparing this configuration.

## Production without Docker

Use Node.js 24, a process supervisor, HTTPS reverse proxy, and writable persistent storage outside the checkout:

```sh
npm ci
npm run build:shared
NODE_ENV=production APP_ORIGIN=https://football.example.com DATA_DIR=/your/persistent/sideline-data HOST=0.0.0.0 PORT=3001 npm start
```

Replace the example origin and data path, create the directory with permissions for the service user, and save these variables in your process supervisor. The default `npm run build` produces browser-local mode, so use `build:shared` for this website. Restrict backend-port access to the reverse proxy.

## Persistent database and backups

The Compose named volume `sideline-data` is mounted at `/data`; SQLite is stored at `/data/sideline.sqlite`. Preserve the volume across rebuilds, restarts, and deployments. `docker compose down --volumes` deletes saved accounts and tournaments.

For a simple consistent backup, briefly stop the service and archive the complete data directory, including SQLite sidecar files:

```sh
mkdir -p backups
docker compose stop sideline
docker compose run --rm --no-deps --entrypoint tar sideline -C /data -czf - . > "backups/sideline-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose start sideline
```

Check the archive command succeeded before treating the backup as valid. Protect backups as private account data, copy them off the server, and test restoration before relying on them. Do not copy only the main database while the service is running: committed data can still be in SQLite's write-ahead log.

For updates, preserve `.env` and the data volume, update the source, then run `docker compose up -d --build`. Back up before database-schema changes. Run one application instance against this SQLite database; multiple replicas, serverless ephemeral filesystems, and static-only hosts need a different deployment/database design.

## Optional managed deployment: Render

[render.yaml](render.yaml) describes a single Docker web service and a 1 GB persistent disk at `/data`. **This uses a paid web-service plan and paid persistent disk.** Review current Render prices before creating resources. The file does not create an account, subscribe to a plan, or deploy anything. A free service without durable disk storage is not suitable for this SQLite setup.

In your Render account, connect the repository and create a Blueprint from `render.yaml`, or create equivalent Docker service/disk settings manually. Set `APP_ORIGIN` to the service's actual assigned HTTPS origin or your configured custom domain. The Blueprint deliberately has no guessed value. If the URL becomes available only after service creation, enter it in environment settings and redeploy; startup rejects a missing or invalid production origin. Render supplies HTTPS for its assigned hostname.

The blueprint sets `PORT=10000`, `HOST=0.0.0.0`, `NODE_ENV=production`, and `DATA_DIR=/data`, with a `/api/session` health check. Keep the persistent disk attached and use one instance. Verify an account and tournament survive a deployed-service restart before sharing its URL. Another Docker-capable host needs the same runtime variables, a persistent writable disk, and HTTPS.

## Install on a phone

The shared HTTPS web app includes a manifest and service worker. Open the deployed site and use the browser's **Install app** / **Add to Home Screen** action on Android, or Safari's Share → **Add to Home Screen** on iPhone/iPad. Wording and prompts depend on the browser. This installs a web app; it is not an APK or App Store package.

The worker caches only public app-shell HTML, manifest/icons, and hashed static assets. It bypasses all API requests and mutations. Accounts and live shared tournaments need a working network; an offline shell does not establish that shared data is current. Viewer-token URLs and their responses are not cached. SVG manifest icons are included; a PNG `apple-touch-icon` can be added for broader iOS icon compatibility.

Register `/sw.js` only for the shared production build on HTTPS or localhost; do not register it for Vite development, browser-local builds, or file-opened standalone exports. Link `/manifest.webmanifest` in the shared site's head. Increment `CACHE_NAME` in `public/sw.js` when changing cache behavior. Activation removes only old `sideline-pwa-*` caches. Updates activate after older controlled tabs close; reopen the app to use the update.

## Validation status

The deployment configuration and service-worker rules can be checked locally without creating hosting resources. A successful local React/API test is separate from a Docker image build, remote deployment, HTTPS access, or installation on an actual phone. Each of those must be verified where it runs; this guide does not claim they have happened.
