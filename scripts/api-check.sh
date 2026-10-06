#!/usr/bin/env bash
# scripts/api-check.sh — verificación estática de las reglas inquebrantables
# de api/mejoras.md §11. Uso: npm run api:check
#
#   Regla 1 (§11.1): sin nombres de recurso, ruta ni endpoint concretos en
#                    core/, engine/ ni primitives/.
#   Regla 5 (§11.5): schema como fuente única — el registry y los archivos
#                    de recurso declaran exactamente los mismos ids.
#   Contract check:  schemas back ↔ front (doc/refactormotor.md §5)
#                    — paths + required + validators; divergencia =
#                    rojo.
#
# Sale con código 1 si hay hallazgos (modos pre-F1 y F1+ según exista
# api/schema/resources/).
set -u
cd "$(dirname "$0")/.."
ROJO=0

echo "── Regla 1 (§11.1): nombres concretos en core/ engine/ primitives/"
DIRS=""
for d in api/core api/engine api/primitives; do
  [ -d "$d" ] && DIRS="$DIRS $d"
done
IDS='categories|products|site|legal|orders'
ROUTES='/admin/('"$IDS"'|schema|upload-signature)'
# shellcheck disable=SC2086
HITS=$(grep -rnE "'($IDS)'|$ROUTES" $DIRS 2>/dev/null | grep -vE ':[0-9]+:[[:space:]]*//' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "✗ ROJO: $(echo "$HITS" | grep -c .) coincidencia(s) — eliminar antes de cerrar la fase"
  ROJO=1
else
  echo "✓ VERDE: 0 hallazgos"
fi

echo "── Regla 5 (§11.5): registry ↔ archivos de recurso"
if [ -d api/schema/resources ]; then
  # Modo auto-registro (F1+): ids declarados en REGISTRY.resources.<id>
  reg_ids=$(grep -rhoE 'REGISTRY\.resources\.[A-Za-z0-9_]+' api/schema/resources/ 2>/dev/null |
    sed 's/.*resources\.//' | sort -u)
  file_ids=$(ls api/schema/resources/*.js 2>/dev/null | sed 's#.*/##;s/\.js$//' | sort)
else
  # Modo índice manual (pre-F1): RESOURCE_REGISTRY en 04-registry vs 03-resources-*.js
  reg_ids=$(grep -oE "id: '[a-z0-9-]+'" api/schema/04-registry.js 2>/dev/null |
    sed "s/id: '//;s/'//" | sort -u)
  file_ids=$(ls api/schema/03-resources-*.js 2>/dev/null | sed 's#.*/##;s/03-resources-//;s/\.js$//' | sort)
fi
if [ "$reg_ids" = "$file_ids" ]; then
  echo "✓ VERDE: ids idénticos ($(echo "$reg_ids" | tr '\n' ' '))"
else
  echo "✗ ROJO: el registry y los archivos de recurso no coinciden"
  echo "--- sólo en el registry:"; comm -23 <(echo "$reg_ids") <(echo "$file_ids") | sed 's/^/    /'
  echo "--- sólo en archivos:"; comm -13 <(echo "$reg_ids") <(echo "$file_ids") | sed 's/^/    /'
  ROJO=1
fi

echo "── Contract check: schemas back ↔ front"
if command -v node >/dev/null 2>&1; then
  if ! node scripts/contract-check.mjs; then
    ROJO=1
  fi
else
  echo "✗ ROJO: node no disponible — contract check no corrió"
  ROJO=1
fi

exit $ROJO
