#!/usr/bin/env bash
# Setup .env.local dal contenuto degli appunti del Mac.
# Idempotente: sovrascrive sempre il file (così se è corrotto, si ripara).
#
# Pre-requisito: avere la service_role key del progetto Supabase JBA
# negli appunti (Cmd+C dalla dashboard).
#
# Usage:
#   bash scripts/setup-env-from-clipboard.sh

set -e

cd "$(dirname "$0")/.."

KEY=$(pbpaste | tr -d '[:space:]')

if [ -z "$KEY" ]; then
  echo "❌ Clipboard vuota."
  echo "   1) Apri https://supabase.com/dashboard/project/falzsvwvmiaerbenwpgs/settings/api-keys"
  echo "   2) Copia la service_role key (Cmd+C)"
  echo "   3) Rilancia: bash scripts/setup-env-from-clipboard.sh"
  exit 1
fi

# Sanity check: una chiave Supabase è o un JWT (eyJ...) lunga ~200+,
# o una nuova secret key (sb_secret_...) lunga ~50. Avvisa se sembra altro.
if [[ ! "$KEY" =~ ^(eyJ|sb_secret_) ]]; then
  echo "⚠  La clipboard non sembra una chiave Supabase service_role."
  echo "   Comincia con: ${KEY:0:11}..."
  echo "   Lunghezza: ${#KEY} caratteri"
  echo "   Atteso: prefisso 'eyJ...' (JWT) o 'sb_secret_...' (nuovo formato)."
  echo "   Procedo lo stesso, ma il parity test molto probabilmente fallirà l'auth."
fi

cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://falzsvwvmiaerbenwpgs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$KEY
EOF

echo "✓ .env.local creato (2 righe):"
echo "  - NEXT_PUBLIC_SUPABASE_URL=https://falzsvwvmiaerbenwpgs.supabase.co"
echo "  - SUPABASE_SERVICE_ROLE_KEY=${KEY:0:11}... (length: ${#KEY})"
echo
echo "Prossimo passo: bash scripts/parity-jakala.sh"
