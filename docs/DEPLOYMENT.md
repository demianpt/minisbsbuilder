# Deployment

The runbook for putting SBS Page Builder on a URL — written for whoever owns the
server, not for whoever wrote the builder.

Target for the first deployment: **https://minisbsbuilder.dsstaging4.com**

---

## What you are deploying

**One stateless Node process.** [`server/index.mjs`](../server/index.mjs) serves
the built client bundle *and* answers `/api/brief/*` on the same port and the
same origin. There is no second service, no static host, no CORS surface and no
database.

| | |
| --- | --- |
| Runtime | Node **20.19+** (pinned to 22.15.1 in `.nvmrc`) |
| Production dependencies | four packages — `express`, `compression`, `dotenv`, `zod` |
| Listening port | `PORT`, default `4174` |
| Persistent state | **none** — no database, no volume, no writable path |
| Outbound calls | `ollama.com` (AI) and `api.shutterstock.com` (stock search), both optional |
| Runtime file set | `dist/`, `server/`, `shared/`, `package.json`, production `node_modules` — about 12 MB with dependencies |

Every project a strategist builds lives in that browser's own storage until they
export it. Nothing is written server-side, so **two instances behind a load
balancer need no session affinity**, and a container can be replaced at any time.

### It is not a static site

`npm run build` produces `dist/`, but publishing only `dist/` to a CDN or an
nginx root deletes the AI features: the brief reader, the copywriter, the concept
designer and the stock imagery are all HTTP calls to this process. Deploy the
process; it serves the bundle itself.

---

## Path A — Docker Compose (recommended)

```bash
git clone <repo> /srv/minisbsbuilder && cd /srv/minisbsbuilder
cp deploy/env.staging.example .env.staging
$EDITOR .env.staging                 # PUBLIC_APP_ORIGIN + the two credentials
docker compose up -d --build
curl -fsS http://127.0.0.1:4174/healthz
```

Then put nginx in front:

```bash
sudo cp deploy/nginx/minisbsbuilder.dsstaging4.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/minisbsbuilder.dsstaging4.com.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d minisbsbuilder.dsstaging4.com
sudo nginx -t && sudo systemctl reload nginx
```

The container publishes to `127.0.0.1:4174` only, runs read-only as a non-root
user with `no-new-privileges`, and restarts unless stopped. Updating is
`git pull && docker compose up -d --build`.

## Path B — systemd, no Docker

For a host that already runs other Node services under systemd.

```bash
sudo useradd --system --home /srv/minisbsbuilder --shell /usr/sbin/nologin sbs
sudo install -d -o sbs -g sbs /srv/minisbsbuilder/releases
sudo -u sbs git clone <repo> /srv/minisbsbuilder/repo

sudo install -o sbs -g sbs -m 600 /dev/null /etc/minisbsbuilder.env
sudo cp deploy/env.staging.example /etc/minisbsbuilder.env && sudoedit /etc/minisbsbuilder.env

sudo cp deploy/systemd/minisbsbuilder.service /etc/systemd/system/
sudo systemctl daemon-reload

sudo -u sbs /srv/minisbsbuilder/repo/deploy/deploy.sh
sudo systemctl enable minisbsbuilder
```

[`deploy/deploy.sh`](../deploy/deploy.sh) is what CI runs on every push to
`main`. It checks out the requested ref, builds it, runs the configuration
preflight, installs production dependencies into a new timestamped release
directory, swaps the `current` symlink, restarts the service, and **rolls back
to the previous release if the new one fails `/healthz`**. The last five
releases are kept, so a manual rollback is a symlink swap:

```bash
sudo -u sbs ln -sfn /srv/minisbsbuilder/releases/<older> /srv/minisbsbuilder/current.new
sudo -u sbs mv -Tf /srv/minisbsbuilder/current.new /srv/minisbsbuilder/current
sudo systemctl restart minisbsbuilder
```

## Path C — a PaaS, if the box is not ready

Any Node host works with no repository changes: build `npm ci && npm run build`,
start `npm start`, health check `/healthz`, and the environment variables below.
`PORT` comes from the platform. This is the fastest way to get a URL in front of
somebody today; the domain moves later with a CNAME.

---

## Environment

Full template with commentary: [`deploy/env.staging.example`](../deploy/env.staging.example).

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `HOST` | **yes** | `0.0.0.0`. The default is loopback, which is unreachable from a proxy or another container |
| `PORT` | | default `4174` |
| `PUBLIC_APP_ORIGIN` | **yes** | The exact public origin, scheme included, no path, no trailing slash |
| `TRUST_PROXY` | behind a proxy | `loopback` when nginx is on the same host; a hop count otherwise |
| `OLLAMA_API_KEY` | for AI features | Absent, every AI job falls back to the built-in planner and the UI says so |
| `OLLAMA_MODEL` | | `gemma4:31b` |
| `OLLAMA_TIMEOUT_MS` | | `180000`. A proxy in front must allow at least this long |
| `SHUTTERSTOCK_API_TOKEN` | for stock imagery | Or `SHUTTERSTOCK_CLIENT_ID` + `SHUTTERSTOCK_CLIENT_SECRET` |
| `BRIEF_BRAIN_RATE_LIMIT_MAX` | | `30` AI jobs per minute per client. Raise for a shared demo box |

Credentials are server-side only. `publicConfig()` in
[`server/config.mjs`](../server/config.mjs) is the entire browser-facing surface
and reports *whether* each credential exists, never its value — asserted by
`tests/security/config.test.mjs`.

### The three that actually break a deployment

**`HOST`** — left at the loopback default, the process starts, logs happily and
is unreachable. The preflight fails on this.

**`PUBLIC_APP_ORIGIN`** — an allowlist, not a label. `enforceOrigin()` in
[`server/routes/brief.mjs`](../server/routes/brief.mjs) rejects any request whose
`Origin` header does not match it exactly, and browsers send `Origin` on
same-origin `POST`s too. Get it wrong and the site loads perfectly while every AI
action returns `403 ORIGIN_FORBIDDEN` — which reads like a broken feature, not a
broken config. No trailing slash. `https`, not `http`.

**`OLLAMA_TIMEOUT_MS` vs the proxy read timeout** — drafting a whole page's copy
is one request that waits on a language model for up to 180 seconds. nginx's
default `proxy_read_timeout` is 60, so the default configuration turns a working
job into a `504` two thirds of the way through. The supplied site config sets
200s on `/api/`.

Run the preflight before starting anything. It prints no secret values:

```bash
npm run check:env        # validate configuration
npm run check:health     # ...and probe a running server
```

---

## Health and monitoring

| Endpoint | Use | Behaviour |
| --- | --- | --- |
| `GET /healthz` | liveness | `200` whenever the process is up. Makes **no** upstream call |
| `GET /readyz` | readiness / deploy gate | `200` when the client bundle is present, `503` with the reason when it is not |
| `GET /api/brief/status` | feature probe | Reports whether the AI and stock providers are configured and reachable. **Makes real network calls — never use this as a liveness probe** |

`/healthz` deliberately ignores the AI provider. An Ollama outage is not an
unhealthy deployment: every job has a deterministic twin in
`shared/brief/planner.mjs`, so the builder keeps working and labels the result as
coming from the built-in planner. Restarting the container would not help and
would drop live requests.

Logs are one JSON object per line on stdout — `journalctl -u minisbsbuilder` or
`docker compose logs -f`. They never contain a request body or a credential.

## Performance

Already handled in the application, so a proxy does not have to:

- **gzip on every text response.** The bundle is **2,315 KB uncompressed and
  392 KB on the wire** — an 83% reduction on the single biggest cost of a cold
  load. If you enable compression at the proxy too, the app's `Content-Encoding`
  must be passed through, not recompressed; the supplied nginx config sets
  `gzip off` for exactly this reason.
- **`Cache-Control: public, max-age=31536000, immutable`** on content-hashed
  assets, and **`no-store` on `index.html`**, which names them. A cached shell
  outliving its own assets is the classic post-deploy white screen.
- **Upstream keep-alive.** `keepAliveTimeout` is 65s, longer than the nginx pool
  it sits behind, so nginx always closes an idle socket first and never reuses
  one the app is closing — the usual source of sporadic 502s.
- **Graceful shutdown.** `SIGTERM` closes the listener, lets in-flight AI jobs
  finish, then drops idle keep-alive sockets after 10s so a restart cannot hang.

Sizing: one instance is comfortable for a strategy team. The process is
CPU-light — it waits on a language model rather than computing — and holds only
an in-memory response cache, so **512 MB of RAM is enough** and the unit caps at
1 GB. Scale horizontally with no coordination if needed; there is no shared
state to keep.

The bundle ships two chunks over 500 KB (`index` and `dst-data`, the 154-pattern
catalogue). They are content-hashed and cached for a year, so this costs a first
visit, not a session.

## CI/CD

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | every PR, every push to `main` | style catalogue validation, 353 unit/integration/security tests, concept-isolation QA, production build, and a **production smoke test** that boots the exact runtime file set and asserts `/healthz`, `/readyz`, `/api/brief/status` and the shell all answer |
| [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml) | push to `main`, or manually | runs `ci.yml`, then SSHes to the box, runs `deploy/deploy.sh`, and confirms the public URL reports healthy |
| [`browser-tests.yml`](../.github/workflows/browser-tests.yml) | nightly, or manually | the Playwright editor suite, which audits all 154 patterns |

Secrets to add under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `STAGING_SSH_HOST` | `dsstaging4.com` |
| `STAGING_SSH_USER` | the deploy user that owns `/srv/minisbsbuilder` |
| `STAGING_SSH_KEY` | private key, PEM, no passphrase |
| `STAGING_KNOWN_HOSTS` | `ssh-keyscan -H dsstaging4.com` |
| `STAGING_SSH_PORT` | optional, defaults to `22` |

Deploys are serialised (`concurrency: deploy-staging`) and never cancelled
mid-run. Production, when it exists, should be the same definition on a
`production` branch or a tag with a manual approval gate — `main` should not
auto-deploy to it.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Page loads, every AI button fails with `403 ORIGIN_FORBIDDEN` | `PUBLIC_APP_ORIGIN` does not exactly match the browser's origin. Trailing slash, or `http` vs `https` |
| `502` from nginx, app logs look fine | The app is not on `127.0.0.1:4174`, or `HOST` is still loopback inside a container |
| `504` after ~60s on "write the copy" | Proxy `proxy_read_timeout` is below `OLLAMA_TIMEOUT_MS` |
| `429 RATE_LIMITED` for everyone at once | `TRUST_PROXY` is unset behind a proxy, so all visitors share one bucket |
| Blank page, assets 404 after a deploy | `index.html` was served from a cache. It is `no-store` from this app — check for a CDN or proxy overriding it |
| `/readyz` returns `503 unready` | `npm run build` did not run, or `dist/` was not copied into the release |
| AI panel says "built-in planner" | `OLLAMA_API_KEY` is missing or the model is unreachable. Check `/api/brief/status` |
| Stock imagery disabled | No Shutterstock credential. Search-only, so nothing is ever spent |
