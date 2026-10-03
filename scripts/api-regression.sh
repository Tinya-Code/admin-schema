#!/usr/bin/env bash
# scripts/api-regression.sh — smoke de regresión del contrato vs api/fixtures/
#
# Re-ejecuta la batería F0-2 contra el webapp desplegado y compara
# semánticamente (JSON normalizado) contra los fixtures de línea base.
# Se usa tras CADA push de fase (PLAN-MEJORAS, nivel "contrato").
#
# Credenciales: api/.gas-smoke.env (GAS_URL=... GAS_TOKEN=...) — GITIGNORED.
#
# Receta de curl (F0-2): NUNCA usar -X POST — fuerza el método en la
# segunda salta del 302 de GAS y devuelve 405.
set -u
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source api/.gas-smoke.env
: "${GAS_URL:?falta GAS_URL en api/.gas-smoke.env}"
: "${GAS_TOKEN:?falta GAS_TOKEN en api/.gas-smoke.env}"

J=$(mktemp)
RAW=$(mktemp -d)
trap 'rm -f "$J"; rm -rf "$RAW"' EXIT

call() { # $1=archivo-salida  $2=method  $3=path  $4=payload
  curl -sS -L --max-time 60 -c "$J" -b "$J" \
    -H 'Content-Type: text/plain' \
    --data "{\"token\":\"$GAS_TOKEN\",\"method\":\"$2\",\"path\":\"$3\",\"payload\":$4}" \
    "$GAS_URL" > "$RAW/$1.json"
}

call products-list GET /admin/products '{}'
call categories-list GET /admin/categories '{}'
call site-get GET /admin/site '{}'
call legal-get GET /admin/legal '{}'
call schema-get GET /admin/schema '{}'
call upload-signature POST /admin/upload-signature '{"resource":"products"}'
curl -sS -L --max-time 60 -c "$J" -b "$J" -H 'Content-Type: text/plain' \
  --data 'esto-no-es-json' "$GAS_URL" > "$RAW/err-400.json"
curl -sS -L --max-time 60 -c "$J" -b "$J" -H 'Content-Type: text/plain' \
  --data '{"token":"token-malo-123","method":"GET","path":"/admin/products","payload":{}}' \
  "$GAS_URL" > "$RAW/err-401.json"
call err-404 GET /admin/no-existe '{}'
call err-404-key GET /admin/products/no-existe '{}'
call err-422 POST /admin/products '{}'

python3 - "$RAW" api/fixtures <<'PY'
import json, os, re, sys
RAW, FIX = sys.argv[1], sys.argv[2]
VOL = re.compile(r'(timestamp|signature|created_at|updated_at|createdAt|updatedAt|schema_version)$', re.I)

def norm(o):
    if isinstance(o, dict):
        return {k: ('<NORMALIZED>' if VOL.search(k) else norm(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [norm(x) for x in o]
    return o

ok = fail = 0
for f in sorted(os.listdir(FIX)):
    fix = os.path.join(FIX, f)
    cur = os.path.join(RAW, f)
    if not os.path.exists(cur):
        print(f'✗ {f}: sin respuesta en esta corrida'); fail += 1; continue
    try:
        a = norm(json.load(open(cur))); b = norm(json.load(open(fix)))
    except Exception as e:
        print(f'✗ {f}: JSON inválido ({e})'); fail += 1; continue
    if a == b:
        print(f'✓ {f}'); ok += 1
    else:
        print(f'✗ {f}: DIFIERE'); fail += 1
        print(f'    actual: {json.dumps(a, ensure_ascii=False)[:300]}')
        print(f'    base  : {json.dumps(b, ensure_ascii=False)[:300]}')
print(f'——— {ok} idénticos, {fail} con diferencia')
sys.exit(1 if fail else 0)
PY
