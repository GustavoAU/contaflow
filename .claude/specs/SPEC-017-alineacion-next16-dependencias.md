---
id: SPEC-017
titulo: Alineación con Next.js 16 y limpieza de dependencias
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-017-next16-deps
arbol: "[11]"
zonas: []
adrs: []
---

# Alineación con Next.js 16 y limpieza de dependencias

## 1. Problema
El repo arrastra convenciones deprecadas y dependencias sobrantes que confunden a los agentes y añaden superficie:

- `src/middleware.ts`: la convención `middleware` está deprecada en Next.js 16 y se renombró a `proxy`.
- `package.json` incluye `npm` e `install` como devDependencies (probablemente un `pnpm add install` accidental).
- Conviven `shadcn-ui` (paquete deprecado, en `dependencies`) y `shadcn` (en `devDependencies`).
- Está `@types/xlsx` sin `xlsx` (migrado a `exceljs`).
- `eslint-config-next@16.1.6` no coincide con `next@^16.2.9`.
- `@types/node@^20` corre con Node 22 en CI y en el `Dockerfile` (`node:22-alpine`).
- `dotenv` se importa en `prisma.config.ts` y en `test.ts` pero no es dependencia directa de `package.json` (no está en el `node_modules` raíz): es fantasma.
- `prisma.config.ts` reimplementa a mano un parser de `.env.local` (y su comentario dice "sin dependencia extra" mientras importa `dotenv/config`).
- `test.ts` en la raíz hace `new PrismaClient()` sin adapter, lo que no funciona en Prisma 7.
- `vitest.setup.ts` no está referenciado en ninguna config (no hay `setupFiles`): es código muerto.
- `tsconfig.json`: `target: ES2017` y sin `noUncheckedIndexedAccess`.
- `dev` y `build` fuerzan `--webpack`. La razón existe pero no está en el repo: la tienen las notas del dueño (Turbopack corrompe el codegen de rutas de Next 16: 404 anidadas y fallo de type-check en `.next/dev/types/routes.d.ts`). `DECISIONS.md` solo documenta los fallbacks del bloque `webpack()`.
- `package.json` se llama `modern-cg1`.

## 2. Base legal / contable
Ninguna — decisión de ingeniería.

## 3. Alcance
**Incluye:**
- A) **`middleware.ts` → `proxy.ts`** con `npx @next/codemod@latest middleware-to-proxy .` (comando de la doc de Next 16.2.9).
  - La doc de Next 16 confirma: `proxy` corre siempre en runtime `nodejs`, **no se puede configurar** (poner `runtime` en un archivo proxy lanza error) y el runtime `edge` no está soportado: quien lo necesite debe seguir con `middleware`. El export con nombre `middleware` pasa a `proxy`.
  - **Antes**, comprobar que `clerkMiddleware` de `@clerk/nextjs` v7 funciona en `proxy.ts`: la documentación consultada (Context7) solo describe `middleware.ts`, así que **no está comprobado**. Mirar el changelog de `@clerk/nextjs` o probar en un spike.
  - Este repo no usa el middleware de routing de `next-intl` (solo `createNextIntlPlugin` para `src/i18n/request.ts`), así que el riesgo de next-intl es menor que el supuesto.
  - Confirmar que la inyección de CSP con nonce sigue funcionando (`csp-style-nonce-watch.test.ts`) y que `src/lib/public-routes.test.ts` sigue en verde.
  - Actualizar las menciones a `middleware.ts`: comentario de `next.config.ts` ("CSP is now injected per-request in middleware.ts"), sección "### middleware.ts" de `CLAUDE.md` y ADRs que lo citen (`grep -rn "middleware"`).
  - Si Clerk exige `edge`, **no** se migra: se registra la razón en `DECISIONS.md` y se sigue con el resto.
- B) **Dependencias:**
  - Quitar `npm`, `install`, `shadcn-ui` y `@types/xlsx`.
  - Alinear `eslint-config-next` con la versión de `next`.
  - `@types/node` a `^22`.
  - Añadir `dotenv` como devDependency explícita, o eliminar su uso (ver C).
  - Antes de quitar cada paquete, `grep` de imports en `src/`, `scripts/`, `prisma/` y configs para confirmar que nadie lo usa.
- C) **`prisma.config.ts`:** reemplazar el parser casero por la API estándar, **con la misma precedencia**.
  - Hoy: `dotenv/config` carga `.env` sin pisar variables ya definidas y luego el parser casero asigna `.env.local` **pisando todo**, incluso variables de la shell.
  - `dotenv` y `process.loadEnvFile` de Node 22 **no sobrescriben** variables ya definidas, así que el orden debe invertirse: cargar `.env.local` primero y `.env` después (con `dotenv`, un array `path: [".env.local", ".env"]`; el primero gana).
  - Test (CA-3) que caracteriza ambos comportamientos: `.env.local` gana a `.env`; y qué pasa con una variable ya presente en la shell. Si el comportamiento nuevo difiere del actual en el segundo caso, se decide y se documenta (el CI no tiene `.env.local`, así que no cambia nada allí).
- D) Borrar `test.ts` de la raíz. Borrar `vitest.setup.ts`, o referenciarlo en `setupFiles` si algún test depende de `.env`; decidir midiendo (correr la suite con y sin él).
- E) **`tsconfig.json`:**
  - `target: "ES2022"` (activa `useDefineForClassFields` por defecto; `tsc --noEmit` lo verifica).
  - **Medir** cuántos errores produce `noUncheckedIndexedAccess: true` (`npx tsc --noEmit` con el flag) y registrar el número en la sección 11. Si son ≤ 50, activarlo y corregirlos aquí. Si son más, se abre una spec aparte y aquí no se activa.
- F) **Turbopack (investigar, no forzar):**
  - Correr `next build` y `next dev` sin `--webpack` y comprobar si el bug conocido (404 anidadas, type-check de `routes.d.ts`) sigue en la versión instalada de Next.
  - La configuración `webpack()` de `next.config.ts` solo hace dos cosas: fallbacks `fs/path/child_process/net/tls: false` en cliente, y `maxAge` de la cache.
  - Identificar qué import de cliente necesita esos fallbacks (sospechosos: `node-forge`, `tesseract.js`, `exceljs`) y ver si `turbopack.resolveAlias` lo resuelve.
  - Resultado esperado: se mantiene `--webpack` y la razón (bug de Turbopack, con la versión en la que se midió) queda en `DECISIONS.md`. Si el bug ya no existe, se migra con la config equivalente en `turbopack`. Ambos son cierres válidos.
- G) `package.json`: `"name": "contaflow"` (hoy `modern-cg1`). Comprobar que nada dependa del nombre (`grep`, Dockerfile, `docker-compose.yml`, `vercel.json`).

**No incluye (explícito):**
- Cambio de generador de Prisma (SPEC-018).
- Corregir más de 50 errores de `noUncheckedIndexedAccess`.
- Upgrades mayores de dependencias.

## 4. Reglas de negocio
- RN-1: Ningún cambio de comportamiento observable para el usuario final.
- RN-2: El orden de precedencia de variables de entorno del CLI de Prisma no cambia (`.env.local` gana a `.env`).
- RN-3: Cada dependencia eliminada tiene 0 imports en `src/`, `scripts/` y `prisma/`.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
No aplica. Archivos:
- `src/middleware.ts` → `src/proxy.ts` (si A procede)
- `package.json`, `pnpm-lock.yaml`
- `prisma.config.ts`
- `tsconfig.json`
- `next.config.ts` (comentario de CSP; y la config de Turbopack solo si F concluye migrar)
- borrar `test.ts` y, según D, `vitest.setup.ts`
- `CLAUDE.md` (sección middleware), `DECISIONS.md`

## 8. UI
No aplica. Verificación manual: login de Clerk, redirect de rutas protegidas, cambio de idioma (next-intl) y que la CSP tenga nonce en `pnpm build && pnpm start`.

## 9. Criterios de aceptación
- [ ] CA-1: `pnpm build` y `pnpm start` sirven la app. Rutas públicas y protegidas se comportan igual que antes (`src/lib/public-routes.test.ts` y `csp-style-nonce-watch.test.ts` en verde y verificación manual del punto 8).
- [ ] CA-2: `pnpm install --frozen-lockfile` pasa y ya no aparecen `npm`, `install`, `shadcn-ui` ni `@types/xlsx`.
- [ ] CA-3: Test de `prisma.config.ts`: con `DATABASE_URL_DIRECT` distinta en `.env` y `.env.local`, gana la de `.env.local`; el caso de variable ya presente en la shell queda caracterizado.
- [ ] CA-4: `tsc --noEmit` en 0 errores con `target: ES2022`. La sección 11 registra el conteo de `noUncheckedIndexedAccess` y la decisión.
- [ ] CA-5: `DECISIONS.md` registra la decisión de Turbopack (migrado, o por qué se mantiene `--webpack` y con qué versión de Next se midió) y, si aplica, por qué `proxy.ts` no se adoptó.
- [ ] CA-6: Suite completa `vitest run` con el mismo número de tests en verde que la línea base.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- R-1: El codemod de proxy puede no detectar el `export default clerkMiddleware(...)`. Revisar el diff a mano.
- R-2: `next-intl` solo aporta el plugin de `request.ts`; aun así, verificar el cambio de idioma.
- R-3: Quitar `--webpack` puede cambiar el tamaño de los bundles. Comparar el output de `next build` antes y después y registrarlo.
- R-4: Esta spec toca `src/middleware.ts`, que contiene el flujo de autenticación y la CSP. `security-agent` revisa el diff antes del merge (trigger de `CLAUDE.md`: cambio en autenticación).

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: `src/middleware.ts` existe (65 líneas, `export default clerkMiddleware(...)`); `npm` e `install` en devDependencies; `shadcn-ui` en dependencies y `shadcn` en devDependencies; `@types/xlsx` presente; `eslint-config-next 16.1.6` frente a `next ^16.2.9`; `@types/node ^20.19.41`; `package.json` sin `dotenv`; `test.ts` y `vitest.setup.ts` en la raíz, el segundo sin referencia; `tsconfig` con `target ES2017` y sin `noUncheckedIndexedAccess`; los scripts `dev`/`build` con `--webpack`; `"name": "modern-cg1"`; el bloque `webpack()` de `next.config.ts` hace exactamente lo descrito.
- Corregido: la precedencia actual de `prisma.config.ts` (el parser pisa incluso variables de la shell; `dotenv` no) y la consecuencia para el orden de carga.
- Corregido: la razón de `--webpack` sí existe (bug de Turbopack), solo que fuera del repo; el cierre esperado de F es mantenerlo documentado.
- Corregido: el riesgo de `next-intl` es menor (no se usa su middleware).
- Confirmado con documentación: Next 16.2.9 renombra `middleware` a `proxy`, runtime fijo `nodejs`, sin `edge`, codemod `npx @next/codemod@latest middleware-to-proxy .` (docs de Next vía Context7 `/vercel/next.js/v16.2.9`).
- No comprobado: que `clerkMiddleware` de `@clerk/nextjs` v7 funcione en `proxy.ts` (la documentación consultada solo trata `middleware.ts`); el conteo de errores de `noUncheckedIndexedAccess`; el estado actual del bug de Turbopack.

## 12. Cierre
