#!/usr/bin/env bash
# scripts/release.sh — Automatiza el proceso de release de ContaFlow
#
# Uso:
#   ./scripts/release.sh 1.0.0        # release normal
#   ./scripts/release.sh 1.0.0-rc.1   # release candidate (no deploy automático)
#
# Prerrequisitos:
#   - Estar en rama 'main' con working directory limpio
#   - npx tsc --noEmit y npx vitest run en verde
#   - CHANGELOG.md actualizado con los cambios bajo [Unreleased]

set -euo pipefail

VERSION=${1:-}

# ── Validaciones ──────────────────────────────────────────────────────────────

if [ -z "$VERSION" ]; then
  echo "❌ Uso: ./scripts/release.sh <version>"
  echo "   Ejemplo: ./scripts/release.sh 1.0.0"
  exit 1
fi

if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "❌ Versión inválida: $VERSION"
  echo "   Formato requerido: X.Y.Z o X.Y.Z-rc.N"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working directory no está limpio. Haz commit o stash de los cambios."
  git status --short
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ Necesitas estar en rama 'main'. Actualmente en: $BRANCH"
  exit 1
fi

if git tag | grep -q "^v${VERSION}$"; then
  echo "❌ El tag v${VERSION} ya existe."
  exit 1
fi

echo "🚀 Preparando release ContaFlow v${VERSION}..."
echo ""

# ── Verificar que CHANGELOG tiene la versión documentada ──────────────────────

if ! grep -q "## \[${VERSION}\]" CHANGELOG.md && ! grep -q "## \[Unreleased\]" CHANGELOG.md; then
  echo "❌ CHANGELOG.md no tiene una sección [${VERSION}] ni [Unreleased]."
  echo "   Documenta los cambios antes de crear el release."
  exit 1
fi

# ── Phase gate: type check + tests ────────────────────────────────────────────

echo "🔍 Ejecutando phase gate..."

echo "  → tsc --noEmit"
if ! npx tsc --noEmit; then
  echo "❌ Errores de TypeScript. Corrige antes de hacer release."
  exit 1
fi

echo "  → vitest run"
if ! npx vitest run; then
  echo "❌ Tests fallando. Corrige antes de hacer release."
  exit 1
fi

echo "✅ Phase gate OK"
echo ""

# ── Actualizar package.json ───────────────────────────────────────────────────

echo "📦 Actualizando package.json a v${VERSION}..."
# Compatible con macOS (BSD sed) y Linux (GNU sed)
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" package.json
else
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" package.json
fi

# ── Actualizar CHANGELOG: mover [Unreleased] → [VERSION] ─────────────────────

TODAY=$(date +%Y-%m-%d)

if grep -q "## \[Unreleased\]" CHANGELOG.md; then
  echo "📝 Moviendo [Unreleased] → [${VERSION}] en CHANGELOG.md..."
  # Agrega nueva sección [VERSION] y restablece [Unreleased] vacío
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/## \[Unreleased\]/## [${VERSION}] - ${TODAY}/" CHANGELOG.md
  else
    sed -i "s/## \[Unreleased\]/## [${VERSION}] - ${TODAY}/" CHANGELOG.md
  fi

  # Insertar nuevo [Unreleased] vacío al inicio del changelog
  UNRELEASED_BLOCK="## [Unreleased]\n\n### Added\n- (Features pendientes de release)\n\n### Fixed\n- (Fixes pendientes de release)\n\n---\n\n"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "/^## \[${VERSION}\]/i\\
${UNRELEASED_BLOCK}
" CHANGELOG.md
  else
    sed -i "/^## \[${VERSION}\]/i ${UNRELEASED_BLOCK}" CHANGELOG.md
  fi
fi

# ── Commit + Tag ──────────────────────────────────────────────────────────────

echo ""
echo "📌 Creando commit y tag..."
git add package.json CHANGELOG.md
git commit -m "chore: release v${VERSION}"
git tag -a "v${VERSION}" -m "ContaFlow v${VERSION}

Fecha: ${TODAY}
Detalles: ver CHANGELOG.md"

echo "✅ Commit y tag v${VERSION} creados."
echo ""

# ── Push ──────────────────────────────────────────────────────────────────────

echo "🔁 Pushing a GitHub..."
git push origin main
git push origin "v${VERSION}"

echo ""
echo "✅ Release v${VERSION} completado."
echo ""
echo "Próximos pasos:"
echo "  1. CI: https://github.com/GustavoAU/modern-cg1/actions"
echo "  2. Release: https://github.com/GustavoAU/modern-cg1/releases/tag/v${VERSION}"
echo "  3. Vercel despliega automáticamente desde GitHub."
