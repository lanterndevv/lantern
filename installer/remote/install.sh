#!/usr/bin/env bash
# Instalador remoto de Lantern (Ubuntu/Debian/Oracle Linux). Idempotente: re-ejecutar actualiza.
# Uso: sudo bash install.sh --releases URL --version V [--port 8787] [--domain D] [--livekit] [--laya]
#                           [--dm-name N] [--title T] [--extra-env FILE] [--caddyfile FILE]
set -euo pipefail

RELEASES="" VERSION="" PORT=8787 DOMAIN="" LIVEKIT=0 LAYA=0 DM_NAME="DM" TITLE="Mesa de Lantern"
EXTRA_ENV="" CADDYFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --releases) RELEASES="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --livekit) LIVEKIT=1; shift ;;
    --laya) LAYA=1; shift ;;
    --dm-name) DM_NAME="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --extra-env) EXTRA_ENV="$2"; shift 2 ;;
    --caddyfile) CADDYFILE="$2"; shift 2 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$RELEASES" ] && [ -n "$VERSION" ] || { echo "faltan --releases y --version" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "ejecuta como root (sudo)" >&2; exit 2; }
# SKIP_SYSTEMD=1 (pruebas en contenedor): no toca systemd, cortafuegos ni Caddy
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"

say() { echo "[lantern] $*"; }
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
esac
CADDY_ARCH=$([ "$ARCH" = x64 ] && echo amd64 || echo arm64)

say "instalando dependencias"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq curl ca-certificates unzip tar >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q curl ca-certificates unzip tar >/dev/null
else
  echo "distribución no soportada (se necesita apt o dnf)" >&2; exit 1
fi

id lantern >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lantern --shell /usr/sbin/nologin lantern
mkdir -p /opt/lantern /etc/lantern /var/lib/lantern/assets /var/lib/lantern/backups
chown -R lantern:lantern /var/lib/lantern

# --- lantern-server (SHA256 obligatorio)
say "descargando lantern-server $VERSION ($ARCH)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BIN="lantern-server-linux-$ARCH"
curl -fsSL "$RELEASES/$VERSION/$BIN" -o "$TMP/$BIN"
curl -fsSL "$RELEASES/$VERSION/SHA256SUMS" -o "$TMP/SHA256SUMS"
WANT=$(awk -v f="$BIN" '$2==f || $2=="*"f {print $1}' "$TMP/SHA256SUMS" | head -1)
[ -n "$WANT" ] || { echo "SHA256SUMS no lista $BIN" >&2; exit 1; }
GOT=$(sha256sum "$TMP/$BIN" | awk '{print $1}')
[ "$WANT" = "$GOT" ] || { echo "SHA256 no coincide para $BIN (esperado $WANT, obtenido $GOT)" >&2; exit 1; }
install -m 755 "$TMP/$BIN" /opt/lantern/lantern-server.new
mv -f /opt/lantern/lantern-server.new /opt/lantern/lantern-server

# --- /etc/lantern/lantern.env (600). Conserva el token de admin y lo ya configurado.
ENV=/etc/lantern/lantern.env
[ -f "$ENV" ] || { umask 077; : > "$ENV"; }
setenv() { { grep -v "^$1=" "$ENV" || true; } > "$ENV.tmp"; printf '%s=%s\n' "$1" "$2" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; }
grep -q '^LANTERN_ADMIN_TOKEN=' "$ENV" || setenv LANTERN_ADMIN_TOKEN "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
setenv PORT "$PORT"; setenv HOST 127.0.0.1
setenv LANTERN_DB /var/lib/lantern/lantern.db; setenv LANTERN_ASSETS /var/lib/lantern/assets
setenv LANTERN_BACKUP_DIR /var/lib/lantern/backups
[ -z "$DOMAIN" ] || setenv LANTERN_ORIGIN "https://$DOMAIN"

# --- LiveKit (opcional, detrás de Caddy en /livekit)
if [ "$LIVEKIT" = 1 ]; then
  if [ ! -x /opt/lantern/livekit-server ]; then
    say "instalando LiveKit"
    LK=$(curl -fsSL https://api.github.com/repos/livekit/livekit/releases/latest | grep -o '"tag_name": *"v[^"]*"' | head -1 | sed 's/.*"v\(.*\)"/\1/')
    curl -fsSL "https://github.com/livekit/livekit/releases/download/v$LK/livekit_${LK}_linux_${CADDY_ARCH}.tar.gz" | tar -xz --no-same-owner -C /opt/lantern livekit-server
  fi
  if [ ! -f /etc/lantern/livekit.yaml ]; then
    LKK="lk$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    LKS=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    ( umask 077; cat > /etc/lantern/livekit.yaml <<YAML
port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
keys:
  $LKK: $LKS
YAML
    )
    setenv LANTERN_LIVEKIT_KEY "$LKK"; setenv LANTERN_LIVEKIT_SECRET "$LKS"
  fi
  chown lantern:lantern /etc/lantern/livekit.yaml
  [ -z "$DOMAIN" ] || setenv LANTERN_LIVEKIT_URL "wss://$DOMAIN/livekit"
fi

# --- Laya (opcional): uv + venv CPU
if [ "$LAYA" = 1 ]; then
  if [ ! -x /opt/lantern/laya/.venv/bin/python ]; then
    say "instalando Laya (uv + torch CPU; tarda unos minutos)"
    command -v uv >/dev/null || curl -fsSL https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
    mkdir -p /opt/lantern/laya
    uv venv --python 3.12 /opt/lantern/laya/.venv
    uv pip install --python /opt/lantern/laya/.venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu
    uv pip install --python /opt/lantern/laya/.venv/bin/python laya
    chown -R lantern:lantern /opt/lantern/laya
  fi
  setenv LANTERN_LAYA 1; setenv LANTERN_LAYA_PYTHON /opt/lantern/laya/.venv/bin/python; setenv LANTERN_LAYA_DEVICE cpu
fi

# --- claves extra del usuario (IA, etc.): sobrescriben lo anterior
if [ -n "$EXTRA_ENV" ] && [ -f "$EXTRA_ENV" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    setenv "${line%%=*}" "${line#*=}"
  done < "$EXTRA_ENV"
  rm -f "$EXTRA_ENV" || true
fi
chown lantern:lantern "$ENV"; chmod 600 "$ENV"

if [ "$SKIP_SYSTEMD" = 1 ]; then say "SKIP_SYSTEMD=1: fin (sin servicios)"; exit 0; fi

# --- unidades systemd
cat > /etc/systemd/system/lantern.service <<UNIT
[Unit]
Description=Lantern
After=network-online.target
Wants=network-online.target
[Service]
User=lantern
Group=lantern
WorkingDirectory=/var/lib/lantern
Environment=LANTERN_CONFIG=/etc/lantern/lantern.env
ExecStart=/opt/lantern/lantern-server
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
[Install]
WantedBy=multi-user.target
UNIT
if [ "$LIVEKIT" = 1 ]; then
  cat > /etc/systemd/system/lantern-livekit.service <<UNIT
[Unit]
Description=Lantern LiveKit
After=network-online.target
[Service]
User=lantern
ExecStart=/opt/lantern/livekit-server --config /etc/lantern/livekit.yaml
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
fi

# --- Caddy (binario oficial; HTTPS automático). El Caddyfile lo genera el instalador en Go.
if [ ! -x /usr/local/bin/caddy ]; then
  say "instalando Caddy"
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$CADDY_ARCH" -o /usr/local/bin/caddy.new
  chmod 755 /usr/local/bin/caddy.new && mv -f /usr/local/bin/caddy.new /usr/local/bin/caddy
fi
id caddy >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
if [ -n "$CADDYFILE" ] && [ -f "$CADDYFILE" ]; then mv -f "$CADDYFILE" /etc/caddy/Caddyfile; fi
[ -f /etc/caddy/Caddyfile ] || { echo "falta el Caddyfile" >&2; exit 1; }
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
cat > /etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT

# --- cortafuegos del propio equipo (80/443 + 7881/tcp y 7882/udp para LiveKit)
open_port() { # proto puerto
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "$2/$1" >/dev/null
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$2/$1" >/dev/null && firewall-cmd --reload >/dev/null
  elif command -v iptables >/dev/null; then
    iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT
    # ponytail: solo IPv4; añade ip6tables si hace falta IPv6
  fi
}
for p in 80 443; do open_port tcp $p; done
if [ "$LIVEKIT" = 1 ]; then open_port tcp 7881; open_port udp 7882; fi
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
if grep -qs OracleCloud /sys/class/dmi/id/chassis_asset_tag 2>/dev/null; then
  say "AVISO Oracle: abre también 80/443 (y 7881/tcp, 7882/udp si usas voz) en la Security List de la VCN, o nada será accesible desde fuera."
fi

systemctl daemon-reload
systemctl enable lantern caddy >/dev/null 2>&1
systemctl restart lantern
[ "$LIVEKIT" = 1 ] && { systemctl enable lantern-livekit >/dev/null 2>&1; systemctl restart lantern-livekit; }
systemctl restart caddy

# --- espera al servidor y crea la primera mesa (solo si no hay ninguna)
TOKEN=$(grep '^LANTERN_ADMIN_TOKEN=' "$ENV" | cut -d= -f2-)
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "el servidor no arrancó: journalctl -u lantern" >&2; exit 1; }
STATUS=$(curl -fsS -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/admin/status")
if echo "$STATUS" | grep -Eq '"rooms": *0'; then
  say "creando la primera mesa"
  esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  RES=$(curl -fsS -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"dmName\":\"$(esc "$DM_NAME")\",\"title\":\"$(esc "$TITLE")\"}" "http://127.0.0.1:$PORT/admin/bootstrap")
  echo "LANTERN_BOOTSTRAP $RES"
else
  say "ya hay mesas; no se crea otra"
fi
say "listo"
