# GitHub Secrets — ContaFlow CI/CD

## Donde configurar

**Repository Settings → Secrets and variables → Actions → New repository secret**

---

## Secrets requeridos

### Para CI (tests + lint)

| Secret | Valor | Donde obtenerlo |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` o `pk_test_...` | Clerk Dashboard → API Keys → Publishable key |
| `CLERK_SECRET_KEY` | `sk_live_...` o `sk_test_...` | Clerk Dashboard → API Keys → Secret key |
| `GROQ_API_KEY` | `gsk_...` | console.groq.com → API Keys |

### Para deploy a Neon (opcional — descomentar `deploy-migrations` en ci.yml)

| Secret | Valor | Donde obtenerlo |
|---|---|---|
| `DATABASE_URL_DIRECT` | `postgresql://user:pass@direct.neon.tech/db` | Neon Console → Connection string → Direct |

---

## Como crear un secret en GitHub

1. Ve a tu repo en GitHub
2. Settings → Secrets and variables → Actions
3. "New repository secret"
4. Nombre: el nombre exacto de la tabla arriba
5. Valor: el valor copiado
6. "Add secret"

---

## Como obtener cada uno

### Clerk

1. https://dashboard.clerk.com
2. Selecciona tu aplicacion
3. API Keys
4. Copia "Publishable key" y "Secret key"

### Groq

1. https://console.groq.com/keys
2. "Create API Key"
3. Copia el valor (solo se muestra una vez)

### Neon — DATABASE_URL_DIRECT

1. https://console.neon.tech
2. Tu proyecto → Dashboard → Connection string
3. Selecciona "Direct connection" (no pooled)
4. Copia la URL completa

Valida antes de guardar:
```bash
psql "postgresql://user:pass@direct.neon.tech:5432/dbname" -c "SELECT version();"
```

---

## Validacion post-setup

Abre un PR de prueba. Los jobs deben mostrar:
- `test` job → verde
- `architecture` job → verde
- `security` job → verde
- `ci-result` → "All CI checks PASSED"

Si falla, abre el job en el Actions tab y expande el step que fallo.

---

## Troubleshooting

**"CLERK_SECRET_KEY is not set"**
→ Secret no creado en GitHub. Verifica en Settings → Secrets.

**"GROQ_API_KEY is undefined"**
→ Idem. Crea el secret con el nombre exacto (case-sensitive).

**"Cannot connect to database"**
→ El DATABASE_URL en ci.yml ya tiene mock: `postgresql://mock:mock@localhost:5432/mock`.
  Eso es correcto — los tests no necesitan DB real. Solo `DATABASE_URL_DIRECT` (para deploy) necesita ser real.

**Coverage insuficiente en CI**
→ Los thresholds estan en `vitest.config.ts`. Si el CI falla por coverage pero local pasa, verifica que `npm run coverage` produce `coverage/coverage-summary.json`.
