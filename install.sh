#!/bin/sh
# Lantern: instalador de un comando (Linux y macOS).
#   curl -fsSL https://raw.githubusercontent.com/lanterndevv/lantern/master/install.sh | sh
# Variables: LANTERN_VERSION=vX.Y.Z (versión fija), LANTERN_BIN=ruta (destino, por defecto ~/.local/bin/lantern),
#            LANTERN_RELEASES_BASE=URL (solo para pruebas; por defecto las releases de GitHub).
set -eu

case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in es*) ES=1 ;; *) ES=0 ;; esac
say() { if [ "$ES" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
die() { printf '\n' >&2; if [ "$ES" = 1 ]; then printf 'Error: %s\n' "$1" >&2; else printf 'Error: %s\n' "$2" >&2; fi; exit 1; }

BASE="${LANTERN_RELEASES_BASE:-https://github.com/lanterndevv/lantern/releases}"
if [ -n "${LANTERN_VERSION:-}" ]; then URL="$BASE/download/$LANTERN_VERSION"; else URL="$BASE/latest/download"; fi

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) die "sistema no soportado: $(uname -s). En Windows usa install.ps1." "unsupported system: $(uname -s). On Windows use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "arquitectura no soportada: $(uname -m)." "unsupported architecture: $(uname -m)." ;;
esac
NAME="lantern-installer-$OS-$ARCH"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "hace falta curl o wget." "curl or wget is required."
fi
if command -v sha256sum >/dev/null 2>&1; then hash() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then hash() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else die "hace falta sha256sum o shasum." "sha256sum or shasum is required."; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Descargando el asistente de Lantern ($OS-$ARCH)..." "Downloading the Lantern installer ($OS-$ARCH)..."
fetch "$URL/$NAME" "$TMP/$NAME" || die "no se pudo descargar $URL/$NAME (¿sin conexión, o esa versión no existe?)." "could not download $URL/$NAME (offline, or that version does not exist?)."
fetch "$URL/SHA256SUMS" "$TMP/SHA256SUMS" || die "no se pudo descargar SHA256SUMS." "could not download SHA256SUMS."

WANT="$(awk -v n="$NAME" '$2 == n || $2 == "*" n { print $1; exit }' "$TMP/SHA256SUMS")"
[ -n "$WANT" ] || die "$NAME no figura en SHA256SUMS." "$NAME is not listed in SHA256SUMS."
[ "$(hash "$TMP/$NAME")" = "$WANT" ] || die "el hash SHA-256 no coincide: descarga corrupta o manipulada. No se instala nada." "SHA-256 mismatch: corrupt or tampered download. Nothing was installed."
say "Verificado (SHA-256)." "Verified (SHA-256)."

BIN="${LANTERN_BIN:-$HOME/.local/bin/lantern}"
mkdir -p "$(dirname "$BIN")"
if ! { cp "$TMP/$NAME" "$BIN.new" && chmod +x "$BIN.new" && mv -f "$BIN.new" "$BIN"; }; then die "no se pudo escribir en $BIN." "could not write to $BIN."; fi
if [ "$OS" = macos ]; then xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true; fi

say "Instalado en $BIN. Para volver a abrirlo: lantern" "Installed at $BIN. To open it again: lantern"
case ":$PATH:" in *":$(dirname "$BIN"):"*) ;; *) say "Nota: $(dirname "$BIN") no está en tu PATH; ejecútalo con la ruta completa." "Note: $(dirname "$BIN") is not in your PATH; run it with the full path." ;; esac

# La TUI necesita el teclado: con `curl | sh` stdin es el script, así que se reconecta a la terminal.
if (: </dev/tty) 2>/dev/null; then exec "$BIN" </dev/tty; else exec "$BIN"; fi
