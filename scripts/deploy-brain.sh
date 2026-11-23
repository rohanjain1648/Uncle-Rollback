#!/usr/bin/env bash
# Runs on YOUR machine (Git Bash). Ships the committed code to the brain Sprite and (re)starts the service.
# Needs: sprite CLI logged in, .env.brain next to this repo's root, OWNER=<your github login>.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${OWNER:?set OWNER to your GitHub login, e.g. OWNER=alice scripts/deploy-brain.sh}"
SPRITE="${SPRITE:-uncle-brain}"
S="${SPRITE_FLAG:--s}"   # flag the sprite CLI uses to pick a sprite; check with: sprite exec --help
owner_lc="$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')"
[ -f .env.brain ] || { echo "missing .env.brain (copy .env.example and fill it in)"; exit 1; }

tmp="$(mktemp -d)"
git archive --format=tar.gz -o "$tmp/app.tgz" HEAD
cp .env.brain "$tmp/env.brain"

sprite exec $S "$SPRITE" --file "$tmp/app.tgz:/tmp/app.tgz" --file "$tmp/env.brain:/tmp/env.brain" -- bash -c "
  set -euo pipefail
  SUDO=''; [ \"\$(id -u)\" -ne 0 ] && command -v sudo >/dev/null && SUDO=sudo
  \$SUDO mkdir -p /app /data && \$SUDO chown -R \"\$(id -u):\$(id -g)\" /app /data
  find /app -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  tar xzf /tmp/app.tgz -C /app
  mv /tmp/env.brain /app/.env && chmod 600 /app/.env
  if [ -d /app/acceptance/_demo ]; then mv /app/acceptance/_demo /app/acceptance/${owner_lc}__uncle-demo-pantry; fi
  cd /app && npm ci --no-audit --no-fund --loglevel=error
  cat > /app/start.sh <<'EOS'
#!/usr/bin/env bash
cd /app && set -a && . ./.env && set +a && exec npx tsx src/main.ts
EOS
  chmod +x /app/start.sh
  sprite-env services delete uncle >/dev/null 2>&1 || true
  sprite-env services create uncle --cmd /app/start.sh --dir /app --http-port 8080
"

rm -rf "$tmp"
sprite url update $S "$SPRITE" --auth public
echo "Deployed. Check:  curl \$(sprite info $S $SPRITE | grep -o 'https://[^ ]*sprites.app')/healthz"
