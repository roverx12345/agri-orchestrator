# Seedflower / agri-orchestrator Deployment

## Current scope

This repo currently contains:

- a PostgreSQL-backed backend MVP under `src/backend/`
- a backend worker under `src/backend/worker.ts`
- the host-side `agri-orchestrator` OpenClaw plugin
- no standalone web frontend yet

Production shape in this repo is therefore:

- Docker Compose: `postgres` + `migrate` + `api` + `worker` + `proxy`
- Host runtime: `openclaw` + linked local plugin + optional user-level systemd service

## Files added for deployment

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `deploy/caddy/Caddyfile`
- `.env.example`
- `.env.production.example`
- `scripts/deploy-prod.sh`
- `scripts/smoke-test.sh`
- `scripts/backup-prod.sh`
- `scripts/install-openclaw-plugin.sh`
- `scripts/run-openclaw-gateway.sh`
- `scripts/install-openclaw-user-service.sh`
- `deploy/systemd/openclaw-gateway.service`

## Prerequisites

### Server-side

- Docker Engine + Docker Compose plugin
- Node.js 22+
- npm
- OpenClaw CLI already installed, or install it first
- enough disk for PostgreSQL volume and upload/export storage
- shell user that can access Docker directly, or `sudo` available for Docker commands

### Optional but recommended

- domain name for HTTPS later
- root access if you want `loginctl enable-linger <user>` for persistent user services after logout

## Environment variables

The canonical deployment env file is `.env.production`.
Start from `.env.production.example`.

### Compose / infrastructure

| Variable | Required | Purpose |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | yes | Compose project name, affects container and volume names |
| `BASE_IMAGE` | recommended | App image base, default `node:22-bookworm-slim`; can point to a preloaded local tag when the server cannot reach Docker Hub reliably |
| `CADDY_SITE_ADDRESS` | yes | Caddy listen address, default `:80` |
| `PUBLIC_BASE_URL` | yes | Public origin used by docs and smoke test, e.g. `https://seedflower.example.com` or `http://127.0.0.1` |
| `PUBLIC_API_PREFIX` | yes | Public API prefix, current default `/api` |

### Database

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTGRES_DB` | yes | PostgreSQL database name |
| `POSTGRES_USER` | yes | PostgreSQL user |
| `POSTGRES_PASSWORD` | yes | PostgreSQL password |
| `DATABASE_URL` | yes | Backend/worker connection string; inside Compose it should point to `postgres` |

### API / worker

| Variable | Required | Purpose |
| --- | --- | --- |
| `BACKEND_HOST` | yes | API bind host inside container, normally `0.0.0.0` |
| `BACKEND_PORT` | yes | API internal port, default `3045` |
| `STORAGE_DIR` | yes | Upload/export storage path inside container, default `/app/.runtime-storage` |
| `REMINDER_SCAN_INTERVAL_MS` | yes | Reminder worker scan interval |
| `REMINDER_LOOKAHEAD_MINUTES` | yes | Reserved config for reminder window logic |

### Host-side OpenClaw deployment docs

These variables are documented so operators know which host paths matter; they are not injected into the Docker services by default.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENCLAW_PLUGIN_SOURCE` | recommended | Local plugin source path, usually this repo root |
| `OPENCLAW_CONFIG_PATH` | recommended | OpenClaw config file path, usually `~/.openclaw/openclaw.json` |
| `OPENCLAW_STATE_DIR` | recommended | OpenClaw state/log directory, usually `~/.openclaw` |

## Networking and routing

Current reverse proxy routing:

- `GET /health` -> backend `/health`
- `/api/*` -> backend `/*`
- `/` -> simple plain-text proxy confirmation page

That means external callers should use:

- backend health: `http(s)://<host>/health`
- backend API: `http(s)://<host>/api/...`
- plugin adapter: `http(s)://<host>/api/plugin/...`

## First deployment

### 1. Prepare env

```bash
cd /home/admin/agri-orchestrator-main
cp .env.production.example .env.production
```

Then edit `.env.production` and fill at least:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `PUBLIC_BASE_URL`
- `BASE_IMAGE` if you need to use a local mirror or preloaded image tag
- optional domain / proxy address values

### 2. Deploy the Docker stack

```bash
./scripts/deploy-prod.sh
```

What this does:

1. validates Compose config
2. builds the app image
3. starts PostgreSQL
4. waits for DB health
5. runs repeatable DB migrations
6. starts API, worker, and proxy
7. waits for service health

The deploy and backup scripts first try plain `docker`, then automatically fall back to `sudo docker` when the current user cannot access the Docker socket directly.

### 3. Run the backend smoke test

```bash
PUBLIC_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
```

If using a domain:

```bash
PUBLIC_BASE_URL=https://seedflower.example.com ./scripts/smoke-test.sh
```

### 4. Install or refresh the local OpenClaw plugin

```bash
./scripts/install-openclaw-plugin.sh
```

Notes:

- this script builds the repo
- if the plugin is already linked from this repo, it keeps the existing install
- otherwise it runs `openclaw plugins install -l <repo>`
- it ensures the plugin ends in the loaded state

### 5. Install the OpenClaw user service

```bash
./scripts/install-openclaw-user-service.sh
```

If `systemctl --user` is available, the script reloads and enables the unit.
If not, it prints the manual follow-up commands.

If you need the service to survive logout, one root-level step may still be required:

```bash
sudo loginctl enable-linger <user>
```

## Upgrade procedure

Typical upgrade flow:

```bash
cd /home/admin/agri-orchestrator-main
npm test
./scripts/deploy-prod.sh
./scripts/install-openclaw-plugin.sh
```

Recommended order:

1. update repo contents
2. review `docker-compose*.yml` and env changes
3. run tests locally if possible
4. run `./scripts/deploy-prod.sh`
5. run `./scripts/install-openclaw-plugin.sh`
6. run `./scripts/smoke-test.sh`
7. if OpenClaw user service is installed, restart it if needed

## Rollback guidance

### Application rollback

If a deploy breaks the app but the database schema is still compatible:

1. move repo back to the previous known-good revision
2. rerun `./scripts/deploy-prod.sh`
3. rerun `./scripts/install-openclaw-plugin.sh`

### Database rollback

Current migrations are forward-only.
For a true DB rollback, restore from backup:

```bash
./scripts/backup-prod.sh
```

Recommended rollback posture:

- take a backup before each production upgrade
- treat schema rollback as restore-based, not migration-down based

## Backups

### Run a backup

```bash
./scripts/backup-prod.sh
```

This writes:

- PostgreSQL dump: `postgres.sql`
- runtime storage archive: `storage.tgz`

Default destination:

- `./.backups/<timestamp>/`

## Health, restart, and logs

### Restart policy

- `postgres`: `unless-stopped`
- `api`: `unless-stopped`
- `worker`: `unless-stopped`
- `proxy`: `unless-stopped`
- OpenClaw user service: `Restart=always`

### Health checks

- `postgres`: `pg_isready`
- `api`: HTTP `GET /health`
- `worker`: process commandline check inside container
- `proxy`: `caddy validate`
- OpenClaw: `openclaw plugins info agri-orchestrator` and service status/logs

### Docker logs

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs -f postgres api worker proxy
```

Single-service examples:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml restart api worker proxy
```

### OpenClaw logs and status

If systemd user service is available:

```bash
systemctl --user status openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -f
```

OpenClaw local files:

- config: `~/.openclaw/openclaw.json`
- logs dir: `~/.openclaw/logs/`
- plugin status: `openclaw plugins info agri-orchestrator`

## Repeatability / idempotency notes

### Migrations

Migrations are repeatable because:

- SQL uses `IF NOT EXISTS` for tables and indexes
- migration runner records applied versions in `schema_migrations`

### Deploy script

`./scripts/deploy-prod.sh` is designed to be rerun safely:

- `docker compose config` is deterministic
- the script now validates required env values and rejects placeholder secrets before building
- `build` can be rerun
- `up -d` is idempotent for unchanged services
- migrations are rerun safely
- health waits run every time

### Plugin install

`./scripts/install-openclaw-plugin.sh` is near-idempotent:

- it rebuilds the repo every run
- it validates the current OpenClaw config before changing plugin state
- if the linked source already points to this repo, it skips reinstall
- it only enables the plugin when it is not already loaded
- if you force a reinstall manually, `openclaw plugins install -l <repo>` has already been observed to overwrite config safely and create an OpenClaw backup file

## Known limitations / manual follow-up

1. This repo does not yet include a separate web frontend, so Compose does not start a `web` container.
2. The backend exposes `/plugin/*` adapter endpoints, but the current host-side plugin in this repo still needs a future integration pass if you want all OpenClaw actions to route through that backend adapter exclusively.
3. HTTPS is not auto-enabled yet in the checked-in Caddyfile; it currently runs in plain HTTP mode (`auto_https off`) so you can bring the stack up without a domain.
4. To enable real HTTPS later:
   - set a public DNS name to this server
   - update `CADDY_SITE_ADDRESS` from `:80` to your hostname
   - remove `auto_https off` from `deploy/caddy/Caddyfile`
   - redeploy proxy
5. If `systemctl --user` is unavailable in a non-login shell, install the unit file anyway and enable it from an interactive session.

## Troubleshooting

### `docker compose config` fails

- check `.env.production` exists
- verify no placeholder password remains in `DATABASE_URL`
- verify YAML syntax in `docker-compose.yml` and `docker-compose.prod.yml`

### PostgreSQL is unhealthy

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs postgres
```

Check:

- password mismatch between `POSTGRES_PASSWORD` and `DATABASE_URL`
- port conflicts or broken volume state

### API is unhealthy

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs api
curl -fsS http://127.0.0.1/health
```

Check:

- migration ran successfully
- `DATABASE_URL` resolves to `postgres`
- storage volume is writable

### Worker appears unhealthy

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs worker
```

Check:

- API migrations already ran
- DB connection works
- reminder scan interval is valid

### OpenClaw plugin not visible

```bash
openclaw plugins info agri-orchestrator
```

If missing:

```bash
./scripts/install-openclaw-plugin.sh
```

The install script is safe to rerun after each deployment. It rebuilds the plugin, validates the current OpenClaw config, skips reinstall when the source path already points to this repo, and only re-enables the plugin when needed.

### Docker image build fails while pulling Node or Caddy

If the server intermittently fails to pull from Docker Hub, use a local tag in `.env.production`:

```bash
BASE_IMAGE=node:22-bookworm-slim
```

If you already have a working local image, retag it once and point `BASE_IMAGE` to that tag before rerunning deploy.

### OpenClaw gateway service not staying up

Check:

```bash
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
```

Also inspect:

- `~/.openclaw/openclaw.json`
- `~/.openclaw/logs/`

## Final pre-launch checklist

- [ ] `.env.production` created from template and all placeholder secrets replaced
- [ ] `BASE_IMAGE` confirmed reachable from this server, or changed to a known-good local tag
- [ ] `docker compose ... config` passes
- [ ] PostgreSQL starts healthy
- [ ] migrations run successfully twice in a row
- [ ] API starts healthy and `/health` returns `{ "ok": true }`
- [ ] worker starts and remains running after 1-2 scan intervals
- [ ] proxy routes `/health` and `/api/*` correctly
- [ ] `./scripts/smoke-test.sh` passes against the public base URL
- [ ] `./scripts/backup-prod.sh` has been run at least once and output verified
- [ ] `openclaw plugins info agri-orchestrator` shows `Status: loaded` or can be loaded after gateway restart
- [ ] OpenClaw user service unit is installed, enabled, and restart behavior is verified
- [ ] operator knows where to read logs: Docker logs, OpenClaw logs, and `journalctl`
- [ ] operator knows the rollback path: previous repo revision + backup restore if schema rollback is needed
