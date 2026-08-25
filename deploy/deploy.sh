#!/usr/bin/env bash
#
# Atomic deploy for the systemd path. Builds a new release beside the running
# one, swaps a symlink, restarts, and rolls back if the new release does not
# answer /healthz. Safe to re-run; a failed deploy leaves the previous release
# serving traffic.
#
#   sudo -u sbs deploy/deploy.sh              # deploy origin/main
#   sudo -u sbs REF=v2.9.0 deploy/deploy.sh   # deploy a tag
#
# Expects the layout created in deploy/systemd/minisbsbuilder.service:
#   /srv/minisbsbuilder/repo      a git checkout
#   /srv/minisbsbuilder/releases  timestamped release directories
#   /srv/minisbsbuilder/current   symlink to the live release
set -euo pipefail

ROOT="${DEPLOY_ROOT:-/srv/minisbsbuilder}"
REPO="${DEPLOY_REPO:-$ROOT/repo}"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
SERVICE="${DEPLOY_SERVICE:-minisbsbuilder}"
REF="${REF:-origin/main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4174/healthz}"
KEEP="${KEEP_RELEASES:-5}"

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$REPO/.git" ] || fail "$REPO is not a git checkout. Clone the repository there first."
command -v node >/dev/null || fail "node is not on PATH."

log "Fetching $REF"
git -C "$REPO" fetch --prune --tags origin
git -C "$REPO" reset --hard "$REF"
git -C "$REPO" clean -fdx --exclude=node_modules
SHA="$(git -C "$REPO" rev-parse --short HEAD)"

log "Installing dependencies and building ($SHA)"
# The build needs devDependencies (vite); Playwright is a devDependency used
# only by tests, and no browser binary is ever needed on the server.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm --prefix "$REPO" ci --include=dev
npm --prefix "$REPO" run build

log "Verifying configuration"
# Reads the live environment file the service will run with, so a wrong
# PUBLIC_APP_ORIGIN or a loopback HOST fails here rather than in the browser.
set +u
if [ -r "${DEPLOY_ENV_FILE:-/etc/minisbsbuilder.env}" ]; then
  set -a; . "${DEPLOY_ENV_FILE:-/etc/minisbsbuilder.env}"; set +a
fi
set -u
NODE_ENV=production node "$REPO/scripts/check-env.mjs" || fail "configuration preflight failed"

RELEASE="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$SHA"
log "Staging release $RELEASE"
mkdir -p "$RELEASE"
# Only what the server reads at runtime. Same file set as the container image.
for path in dist server shared package.json package-lock.json; do
  cp -R "$REPO/$path" "$RELEASE/"
done
mkdir -p "$RELEASE/scripts"
cp "$REPO/scripts/check-env.mjs" "$RELEASE/scripts/"
npm --prefix "$RELEASE" ci --omit=dev

PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"
log "Activating"
ln -sfn "$RELEASE" "$CURRENT.new" && mv -Tf "$CURRENT.new" "$CURRENT"
sudo systemctl restart "$SERVICE"

log "Waiting for $HEALTH_URL"
healthy=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then healthy=true; break; fi
  sleep 1
done

if [ "$healthy" != true ]; then
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    log "Unhealthy — rolling back to $PREVIOUS"
    ln -sfn "$PREVIOUS" "$CURRENT.new" && mv -Tf "$CURRENT.new" "$CURRENT"
    sudo systemctl restart "$SERVICE"
    fail "deploy rolled back. Logs: journalctl -u $SERVICE -n 100"
  fi
  fail "new release is unhealthy and there is no previous release to roll back to."
fi

log "Healthy: $(curl -fsS "$HEALTH_URL")"

# Keep the last few releases so a rollback is a symlink swap, not a rebuild.
if [ -d "$RELEASES" ]; then
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    [ "$(readlink -f "$old")" = "$(readlink -f "$CURRENT")" ] && continue
    log "Pruning $old"; rm -rf "$old"
  done
fi

log "Deployed $SHA"
