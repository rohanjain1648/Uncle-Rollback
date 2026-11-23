#!/usr/bin/env bash
# Runs INSIDE the garage Sprite (sprite console into uncle-garage, then: bash garage-setup.sh).
# Prepares tools and the Claude wrapper. Take the `garage-clean` checkpoint AFTER this and after `claude setup-token`.
set -euo pipefail

SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"
need() { command -v "$1" >/dev/null 2>&1; }

if ! need git || ! need jq || ! need curl; then
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git jq curl
fi
python3 -m pytest --version >/dev/null 2>&1 || pip3 install -q --break-system-packages pytest || pip3 install -q pytest || true

$SUDO mkdir -p /work/.uncle
$SUDO chown -R "$(id -u):$(id -g)" /work

cat > /work/.uncle/run-claude.sh <<'EOS'
#!/usr/bin/env bash
# Usage: run-claude.sh <timeout-seconds>. Reads /work/prompt.txt, writes /work/claude-out.json.
rm -f /work/claude-out.json
export CLAUDE_CODE_OAUTH_TOKEN="$(cat /work/.uncle/claude_token 2>/dev/null)"
cd /work/repo || exit 2
timeout --kill-after=10 "$1" claude -p "$(cat /work/prompt.txt)" \
  --output-format json --dangerously-skip-permissions > /work/claude-out.json
EOS
chmod +x /work/.uncle/run-claude.sh

echo "node:   $(node --version 2>/dev/null || echo MISSING)"
echo "claude: $(claude --version 2>/dev/null || echo MISSING)"
echo "git:    $(git --version)"
echo "pytest: $(python3 -m pytest --version 2>&1 | head -1)"
echo "user:   $(id -un) home=$HOME"
if [ -s /work/.uncle/claude_token ]; then
  echo "claude token: present"
else
  echo "claude token: MISSING. Run 'claude setup-token' and save the token with:"
  echo "  umask 077; cat > /work/.uncle/claude_token   (paste, then Ctrl-D)"
fi
