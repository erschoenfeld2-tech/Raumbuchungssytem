#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════
# Alle Tests lokal ausführen:  bash tests/run_tests.sh
#
#   1. Unit-Tests (Node, ohne Browser/DB)          tests/unit_tests.js
#      + Kapazitätslogik der NFC-Brücke (Python)   tests/bridge_tests.py
#   2. Migrationen auf eine FRISCHE lokale Postgres-Datenbank anwenden
#      (neue Migrationen je zweimal direkt hintereinander → idempotent?)
#   3. SQL-Verhaltenstests als Rolle anon          tests/sql_tests.sql
#   4. Browser-Tests mit Chromium/Playwright        tests/e2e_tests.js
#
# Braucht: node, psql + PostgreSQL-Server (initdb/pg_ctl) und Playwright
# (npm i -g playwright && npx playwright install chromium).
# Mit gesetztem PGHOST/PGPORT/PGUSER wird ein vorhandener Server benutzt
# (so läuft es in der CI), sonst startet das Skript einen temporären.
# Die echte Supabase-Datenbank wird NIE angesprochen.
# ══════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Unit-Tests"
node tests/unit_tests.js
echo "▶ NFC-Brücke"
python3 -B tests/bridge_tests.py

if [ -z "${PGHOST:-}" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  export PGHOST="${RB_PGDIR:-/var/tmp/rb-pgtest}" PGPORT="${PGPORT:-54329}" PGUSER=postgres
  if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
    echo "▶ Starte temporären PostgreSQL-Server in $PGHOST"
    rm -rf "$PGHOST"; mkdir -p "$PGHOST"
    ALS=""; [ "$(id -u)" = 0 ] && { chown postgres "$PGHOST"; ALS="su postgres -c"; }
    INIT="$PGBIN/initdb -D $PGHOST/data -A trust -U postgres >/dev/null"
    START="$PGBIN/pg_ctl -D $PGHOST/data -o '-p $PGPORT -k $PGHOST -c listen_addresses=' -l $PGHOST/log start >/dev/null"
    if [ -n "$ALS" ]; then $ALS "$INIT" && $ALS "$START"; else eval "$INIT" && eval "$START"; fi
    sleep 1
  fi
fi
export PGDATABASE=rbtest
P="psql -X -q -v ON_ERROR_STOP=1 -d postgres"

frische_db(){
  $P -c "drop database if exists rbtest" -c "create database rbtest"
  psql -X -q -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql
  for f in supabase/migrations/*.sql; do
    # neue Migrationen (ab dem Etagen-Umbau) direkt zweimal → idempotent?
    durchlaeufe=1; [[ "$(basename "$f")" > "20261119150000" ]] && durchlaeufe=2
    for i in $(seq $durchlaeufe); do
      psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1 | grep -v NOTICE || true
      [ "${PIPESTATUS[0]}" = 0 ] || { echo "✗ Migration $f fehlgeschlagen (Durchlauf $i)"; exit 1; }
    done
  done
}

echo "▶ Migrationen auf frische Datenbank"
frische_db
echo "  ✓ $(ls supabase/migrations/*.sql | wc -l) Migrationen angewendet (neue je zweimal → idempotent)"
echo "▶ SQL-Tests"
psql -X -q -v ON_ERROR_STOP=1 -o /dev/null -f tests/sql_tests.sql

echo "▶ Browser-Tests"
frische_db
node tests/e2e_tests.js
