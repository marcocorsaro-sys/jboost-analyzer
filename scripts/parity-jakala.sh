#!/usr/bin/env bash
# Wrapper per il parity test su jakala.com — il dominio è hard-coded qui
# (e non passato come argomento) per evitare il classico problema di
# macOS Smart Links / Smart Substitutions che converte 'jakala.com' in
# un markdown link al momento del paste in Terminal.
#
# Pre-requisito: file `.env.local` con almeno
#   NEXT_PUBLIC_SUPABASE_URL=https://falzsvwvmiaerbenwpgs.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
#
# Usage:
#   bash scripts/parity-jakala.sh

set -e

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "❌ .env.local mancante nella root del repo."
  echo "   Crealo con queste due righe (sostituisci la SECONDA con la tua chiave):"
  echo
  echo "   NEXT_PUBLIC_SUPABASE_URL=https://falzsvwvmiaerbenwpgs.supabase.co"
  echo "   SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local."
  exit 1
fi

echo "→ URL: $NEXT_PUBLIC_SUPABASE_URL"
echo "→ KEY: ${SUPABASE_SERVICE_ROLE_KEY:0:11}... (length: ${#SUPABASE_SERVICE_ROLE_KEY})"
echo

exec npx tsx scripts/parity-run-analysis.ts \
  --client=490affda-faea-44ab-82db-98f62750fa29 \
  --domain=jakala.com
