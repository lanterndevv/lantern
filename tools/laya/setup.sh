#!/usr/bin/env bash
# Crea tools/laya/.venv con torch (CPU por defecto; --cuda usa el torch por defecto de PyPI) y el paquete público `laya`.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
if [ "${1:-}" = "--cuda" ]; then
  .venv/bin/pip install torch
else
  .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
fi
.venv/bin/pip install laya
# Descarga el modelo ahora (queda en la caché de Hugging Face) para que el primer turno no espere.
.venv/bin/python -c "from laya import Router; Router(device='cpu').preload(['english'])"
echo "Laya listo. El servidor lo usa solo (LANTERN_LAYA=0 lo desactiva)."
