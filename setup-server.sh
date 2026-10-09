#!/usr/bin/env bash
# Sets up Elephante Brief (brief.elephantepress.com) on an existing Ubuntu/Debian droplet that already runs
# another project. It never touches ~/elephante-brief, its Python environment or the crontab.
#
#   bash setup-server.sh <OPENROUTER_API_KEY>           HTTPS through this site's own Caddy (needs ports 80/443 free)
#   bash setup-server.sh <OPENROUTER_API_KEY> --nginx   behind the droplet's existing nginx, certificate by certbot
#
# Run it as the user that should own ~/elephante-brief-wire (root on a default droplet, or a sudo user).
# Safe to run again: existing swap, Docker, Node, checkout and .env are kept (the key is updated if given).
# With --nginx, nothing nginx already serves is changed: only one new server block is added, and it is
# removed again if `nginx -t` rejects it. CERTBOT_EMAIL=you@example.com registers an email for expiry notices.
set -euo pipefail

DOMAIN="brief.elephantepress.com"
EXPECTED_IP="${EXPECTED_IP:-159.203.80.202}"
REPO_URL="${REPO_URL:-https://github.com/egggc/elephante-brief-wire.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="$HOME/elephante-brief-wire"
NODE_VERSION="24.21.0"
NGINX_SITE="/etc/nginx/sites-available/$DOMAIN"
FEED_FAILURES="$(mktemp)"

KEY=""
MODE="caddy"
for arg in "$@"; do
  case "$arg" in
    --nginx) MODE="nginx" ;;
    -*) printf 'Unknown option %s\n' "$arg" >&2; exit 1 ;;
    *) KEY="$arg" ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; command -v sudo >/dev/null || die "Run as root, or install sudo."; fi
[ -n "$KEY" ] || [ -f "$APP_DIR/.env" ] || die "Usage: bash setup-server.sh <OPENROUTER_API_KEY> [--nginx]"
case "$APP_DIR" in "$HOME/elephante-brief") die "Refusing to use ~/elephante-brief (the other project).";; esac

# ── 1. What the web server already does ────────────────────────────────────────────────────
if [ "$MODE" = "nginx" ]; then
  command -v nginx >/dev/null || die "--nginx was given but nginx is not installed."
  say "What nginx serves now (sites-enabled)"
  for f in /etc/nginx/sites-enabled/*; do
    [ -e "$f" ] || continue
    names="$(grep -hoE '^\s*server_name\s+[^;]+' "$f" | sed -E 's/^\s*server_name\s+//' | sort -u | paste -sd ' ' -)"
    listens="$(grep -hoE '^\s*listen\s+[^;]+' "$f" | sed -E 's/^\s*listen\s+//' | sort -u | paste -sd ',' -)"
    target="$(grep -hoE '\b(proxy_pass|root|return)\s+[^;]+' "$f" | sort -u | head -3 | paste -sd ',' -)"
    printf '%-40s server_name: %-40s listen: %-20s -> %s\n' "$(basename "$f")" "${names:-?}" "${listens:-?}" "${target:-?}"
  done
  # Another config already claiming the name would make nginx pick one at random.
  other="$(grep -lE "server_name[^;]*\b$DOMAIN\b" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | while read -r f; do [ "$(readlink -f "$f")" = "$(readlink -f "$NGINX_SITE")" ] || echo "$f"; done)"
  [ -z "$other" ] || die "$DOMAIN is already named in: $other. Remove or rename it there first; nothing was changed."
else
  say "Checking that ports 80 and 443 are free"
  own_caddy() { command -v docker >/dev/null && $SUDO docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^elephante-brief-wire-caddy-'; }
  if own_caddy; then
    echo "Ports are held by this site's own Caddy from an earlier run: fine."
  else
    busy="$($SUDO ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
    if [ -n "$busy" ]; then
      echo "$busy"
      die "Port 80 or 443 is already in use by the process above. Caddy needs both for HTTPS.
  If that is nginx, run again with --nginx to put this site behind it instead."
    fi
    echo "Both free."
  fi
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

# ── 6. .env and the local port ────────────────────────────────────────────────────────────
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
# The web container keeps its port on a re-run; otherwise the first free one from 3000.
own_port="$($DOCKER ps --filter 'name=^elephante-brief-wire-web-' --format '{{.Ports}}' 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | head -1 | cut -d: -f2 || true)"
WEB_PORT="${own_port:-}"
if [ -z "$WEB_PORT" ]; then
  WEB_PORT=3000
  while [ -n "$($SUDO ss -ltnH "sport = :$WEB_PORT" 2>/dev/null)" ]; do WEB_PORT=$((WEB_PORT + 1)); done
fi
[ "$WEB_PORT" = 3000 ] || echo "Port 3000 is taken; using $WEB_PORT."
[ -n "$KEY" ] && set_env LLM_API_KEY "$KEY"
set_env SITE_URL "https://$DOMAIN"
set_env SITE_DOMAIN "$DOMAIN"
set_env PORT "127.0.0.1:$WEB_PORT"
set_env TRUST_PROXY "true"
chmod 600 .env
grep -E '^(SITE_URL|SITE_DOMAIN|PORT|TRUST_PROXY|LLM_BASE_URL|LLM_MODEL)=' .env

# ── 7. Feeds: which ones answer from this server ────────────────────────────────────────────
say "Checking the seed feeds from this server"
FEED_FAILURES="$FEED_FAILURES" "$NODE" -e '
const fs = require("fs");
const { sources } = JSON.parse(fs.readFileSync("industry/sources.json", "utf8"));
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
      if (!ok) failed.push(`${s.id}  ${url}  HTTP ${res.status}${s.kind === "rss" ? `, ${items} items` : ""}`);
    } catch (e) {
      line = `FAIL ${s.id}  ${e.cause?.code ?? e.name}`;
      failed.push(`${s.id}  ${url}  ${e.cause?.code ?? e.name}`);
    }
    console.log(line);
  }
  fs.writeFileSync(process.env.FEED_FAILURES, failed.join("\n"));
})();
' || warn "The feed check did not finish; the site will still start."

# ── 8. Start ──────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "nginx" ]; then
  # A Caddy from an earlier run without --nginx would hold 80/443; it is this site's own.
  $DOCKER compose --profile https stop caddy >/dev/null 2>&1 || true
  say "Building and starting on 127.0.0.1:$WEB_PORT (the first build takes several minutes on 2 GB)"
  $DOCKER compose up -d --build
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/api/health" 2>/dev/null && break; sleep 2; done
  curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/api/health" && echo "The site answers on 127.0.0.1:$WEB_PORT." || warn "The site does not answer on 127.0.0.1:$WEB_PORT yet: docker compose logs web api"
else
  if command -v ufw >/dev/null && $SUDO ufw status | grep -q "Status: active"; then
    echo "ufw is active: allowing 80 and 443"
    $SUDO ufw allow 80/tcp >/dev/null && $SUDO ufw allow 443/tcp >/dev/null
  fi
  say "Building and starting (the first build takes several minutes on 2 GB)"
  $DOCKER compose --profile https up -d --build
fi

# ── 9. nginx server block (--nginx only) ─────────────────────────────────────────────────
if [ "$MODE" = "nginx" ]; then
  say "Adding the nginx server block for $DOMAIN"
  backup=""
  if [ -f "$NGINX_SITE" ]; then backup="$(mktemp)"; $SUDO cp "$NGINX_SITE" "$backup"; fi
  if [ -n "$backup" ] && $SUDO grep -q "managed by Certbot" "$NGINX_SITE"; then
    # Certbot already added HTTPS to this block: only point it at the current port.
    $SUDO sed -i -E "s|proxy_pass http://127\.0\.0\.1:[0-9]+;|proxy_pass http://127.0.0.1:$WEB_PORT;|" "$NGINX_SITE"
  else
    $SUDO tee "$NGINX_SITE" >/dev/null <<EOF
# Elephante Brief: proxied to the docker compose web container (setup-server.sh --nginx).
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Feedback screenshots are up to 8 MB.
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
  fi
  $SUDO ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  if $SUDO nginx -t; then
    $SUDO systemctl reload nginx
    echo "nginx reloaded."
  else
    # Put everything back so nginx keeps serving exactly what it did.
    if [ -n "$backup" ]; then $SUDO cp "$backup" "$NGINX_SITE"; else $SUDO rm -f "/etc/nginx/sites-enabled/$DOMAIN" "$NGINX_SITE"; fi
    die "nginx -t rejected the new block; it was removed and nginx was not reloaded."
  fi

  # ── 10. DNS, then the certificate ───────────────────────────────────────────────────
  say "Checking DNS for $DOMAIN"
  DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
  if [ "$DNS_IP" != "$EXPECTED_IP" ]; then
    warn "$DOMAIN resolves to '${DNS_IP:-nothing}', not $EXPECTED_IP. Stopping before certbot."
    warn "Point the A record at $EXPECTED_IP, wait for it to propagate, then run this script again."
    CERT="skipped (DNS)"
  else
    echo "$DOMAIN → $DNS_IP"
    if ! command -v certbot >/dev/null; then
      echo "Installing certbot with its nginx plugin"
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq certbot python3-certbot-nginx
    fi
    if [ -n "${CERTBOT_EMAIL:-}" ]; then email=(-m "$CERTBOT_EMAIL"); else email=(--register-unsafely-without-email); fi
    $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring "${email[@]}"
    $SUDO nginx -t && $SUDO systemctl reload nginx
    CERT="installed"
  fi
fi

say "Done"
if [ "$MODE" = "nginx" ] && [ "${CERT:-}" != "installed" ]; then echo "Site:  http://$DOMAIN (HTTPS: $CERT)"; else echo "Site:  https://$DOMAIN"; fi
if [ "$MODE" = "nginx" ] && [ "${CERT:-}" != "installed" ]; then echo "Admin: http://$DOMAIN/admin"; else echo "Admin: https://$DOMAIN/admin"; fi
echo "Admin password: $(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
if [ -s "$FEED_FAILURES" ]; then
  echo "Failing feeds ($(grep -c '' "$FEED_FAILURES")): pause or replace them in /admin/sources"
  sed 's/^/  /' "$FEED_FAILURES"; echo
else
  echo "Failing feeds: none"
fi
rm -f "$FEED_FAILURES"
echo "Logs:  cd $APP_DIR && docker compose logs -f worker"
