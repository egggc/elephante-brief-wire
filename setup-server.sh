#!/usr/bin/env bash
# Sets up Elephante Brief (brief.elephantepress.com) on an existing Ubuntu/Debian droplet that already runs
# another project. It never touches ~/elephante-brief, its Python environment or the crontab.
#
#   bash setup-server.sh <OPENROUTER_API_KEY>
#
# Run it as the user that should own ~/elephante-brief-wire (root on a default droplet, or a sudo user).
# Safe to run again: existing swap, Docker, Node, checkout and .env are kept (the key is updated if given).
set -euo pipefail

DOMAIN="brief.elephantepress.com"
REPO_URL="${REPO_URL:-https://github.com/egggc/elephante-brief-wire.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="$HOME/elephante-brief-wire"
NODE_VERSION="24.21.0"
KEY="${1:-}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; command -v sudo >/dev/null || die "Run as root, or install sudo."; fi
[ -n "$KEY" ] || [ -f "$APP_DIR/.env" ] || die "Usage: bash setup-server.sh <OPENROUTER_API_KEY>"
case "$APP_DIR" in "$HOME/elephante-brief") die "Refusing to use ~/elephante-brief (the other project).";; esac

# ── 1. Ports 80 and 443 must be free (Caddy takes them for HTTPS) ──────────────────────────
say "Checking that ports 80 and 443 are free"
own_caddy() { command -v docker >/dev/null && $SUDO docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^elephante-brief-wire-caddy-'; }
if own_caddy; then
  echo "Ports are held by this site's own Caddy from an earlier run: fine."
else
  busy="$($SUDO ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
  if [ -n "$busy" ]; then
    echo "$busy"
    die "Port 80 or 443 is already in use by the process above. Caddy needs both for HTTPS.
  Stop that service first, or put this site behind your existing web server instead
  (proxy $DOMAIN to http://127.0.0.1:3000 and run 'docker compose up -d --build' without --profile https)."
  fi
  echo "Both free."
fi

# ── 2. Swap: a 2 GB droplet needs it to build the image ────────────────────────────────────
say "Checking swap"
if [ -n "$($SUDO swapon --show --noheadings 2>/dev/null)" ]; then
  echo "Swap already exists:"; $SUDO swapon --show
else
  SWAPFILE=/swapfile
  [ -e "$SWAPFILE" ] && SWAPFILE=/swapfile-elephante
  echo "Adding a 4 GB swapfile at $SWAPFILE"
  $SUDO fallocate -l 4G "$SWAPFILE" || $SUDO dd if=/dev/zero of="$SWAPFILE" bs=1M count=4096 status=none
  $SUDO chmod 600 "$SWAPFILE"
  $SUDO mkswap "$SWAPFILE" >/dev/null
  $SUDO swapon "$SWAPFILE"
  grep -q "^$SWAPFILE " /etc/fstab || echo "$SWAPFILE none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
  $SUDO swapon --show
fi

# ── 3. Docker (only if missing) ────────────────────────────────────────────────────────────
say "Checking Docker"
if command -v docker >/dev/null; then
  echo "Docker is installed: $(docker --version)"
else
  echo "Installing Docker from get.docker.com"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
  echo "Installing the Docker Compose plugin"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq docker-compose-plugin
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
DOCKER="$SUDO docker"

# ── 4. Node 24, in its own directory (system Python and any existing Node are left alone) ───
say "Checking Node.js 24"
NODE=""
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then
  NODE="$(command -v node)"
elif [ -x /opt/node24/bin/node ]; then
  NODE=/opt/node24/bin/node
else
  case "$(uname -m)" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) die "Unsupported CPU $(uname -m)";; esac
  echo "Installing Node $NODE_VERSION into /opt/node24"
  $SUDO mkdir -p /opt/node24
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz" | $SUDO tar -xJ -C /opt/node24 --strip-components=1
  NODE=/opt/node24/bin/node
  # Put it on PATH only when there is no other node to shadow.
  command -v node >/dev/null || $SUDO ln -sf /opt/node24/bin/node /usr/local/bin/node
fi
echo "Using $NODE ($("$NODE" -v))"

# ── 5. The code ────────────────────────────────────────────────────────────────────────────
say "Getting the code into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --ff-only --quiet origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR" || die "Could not clone $REPO_URL. If the repository is private, add a deploy key or use REPO_URL=git@github.com:egggc/elephante-brief-wire.git"
fi
cd "$APP_DIR"

# ── 6. .env ───────────────────────────────────────────────────────────────────────────────
say "Writing .env"
if [ -f .env ]; then
  echo ".env already exists: keeping its secrets and admin password."
else
  "$NODE" scripts/init-env.ts --llm-key "$KEY" >/dev/null
fi
set_env() {
  local key="$1" value="$2"
  if grep -qE "^#? ?$key=" .env; then
    sed -i -E "s|^#? ?$key=.*|$key=$value|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
[ -n "$KEY" ] && set_env LLM_API_KEY "$KEY"
set_env SITE_URL "https://$DOMAIN"
set_env SITE_DOMAIN "$DOMAIN"
set_env PORT "127.0.0.1:3000"
set_env TRUST_PROXY "true"
chmod 600 .env
grep -E '^(SITE_URL|SITE_DOMAIN|PORT|TRUST_PROXY|LLM_BASE_URL|LLM_MODEL)=' .env

# ── 7. Feeds: which ones answer from this server ────────────────────────────────────────────
say "Checking the seed feeds from this server"
"$NODE" -e '
const { sources } = JSON.parse(require("fs").readFileSync("industry/sources.json", "utf8"));
(async () => {
  const failed = [];
  for (const s of sources) {
    const url = s.config.feedUrl ?? s.config.url;
    let line;
    try {
      const res = await fetch(url, { headers: { "user-agent": "ElephanteBriefBot/1.0" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
      const text = await res.text();
      const items = (text.match(/<item[\s>]|<entry[\s>]/g) ?? []).length;
      const ok = res.ok && (s.kind !== "rss" || items > 0);
      line = `${ok ? "OK  " : "FAIL"} ${s.id}  HTTP ${res.status}${s.kind === "rss" ? `, ${items} items` : ""}`;
      if (!ok) failed.push(s.id);
    } catch (e) {
      line = `FAIL ${s.id}  ${e.cause?.code ?? e.name}`;
      failed.push(s.id);
    }
    console.log(line);
  }
  console.log(failed.length ? `\n${failed.length} feed(s) failed: ${failed.join(", ")}. The site still runs; pause or replace them in /admin/sources.` : "\nAll feeds answered.");
})();
' || warn "The feed check did not finish; the site will still start."

# ── 8. DNS and firewall ───────────────────────────────────────────────────────────────────
say "Checking DNS for $DOMAIN"
PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
if [ -z "$DNS_IP" ]; then
  warn "$DOMAIN does not resolve yet. Add an A record pointing to ${PUBLIC_IP:-this server}; Caddy gets the certificate once it does."
elif [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  warn "$DOMAIN points to $DNS_IP but this server is $PUBLIC_IP. Fix the A record, or HTTPS will fail."
else
  echo "$DOMAIN → $DNS_IP"
fi
if command -v ufw >/dev/null && $SUDO ufw status | grep -q "Status: active"; then
  echo "ufw is active: allowing 80 and 443"
  $SUDO ufw allow 80/tcp >/dev/null && $SUDO ufw allow 443/tcp >/dev/null
fi

# ── 9. Start ──────────────────────────────────────────────────────────────────────────────
say "Building and starting (the first build takes several minutes on 2 GB)"
$DOCKER compose --profile https up -d --build

say "Done"
echo "Site:  https://$DOMAIN"
echo "Admin: https://$DOMAIN/admin"
echo "Admin password: $(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
echo "Logs:  cd $APP_DIR && docker compose logs -f worker"
