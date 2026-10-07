---
id: SPEC-018
titulo: Migrar al generador prisma-client de Prisma 7
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-018-prisma-client-generator
arbol: "[11]"
zonas: [Z-1, Z-2, Z-3, Z-4, Z-5]
adrs: [ADR-044]
---

# Migrar al generador `prisma-client` de Prisma 7

## 1. Problema
`schema.prisma` usa `provider = "prisma-client-js"` (sin `output`). La guía de upgrade a Prisma 7 indica que ese proveedor se eliminará en una versión futura. El reemplazo es `prisma-client`: sin Rust, ESM y con `output` obligatorio fuera de `node_modules`. Quedarse en el generador viejo es deuda con fecha de vencimiento desconocida.

160 archivos importan desde `@prisma/client` (189 referencias a la cadena). Además, cuatro extensiones críticas dependen de la API del cliente:
- billing gate
- tenant assert (usa `Prisma.dmmf` en el top level del módulo)
- postable-account gate
- tercero-required gate

## 2. Base legal / contable
Ninguna — decisión de ingeniería.

## 3. Alcance
**Incluye:**
- A) **Lectura previa obligatoria y spike.** Guía de upgrade a v7 y referencia del generador `prisma-client` (Context7, `/prisma/web`). Anotar en la sección 11, con cita, qué cambia en: (1) ruta de import, (2) `Prisma.Decimal` y tipos de runtime, (3) disponibilidad de `Prisma.dmmf`, (4) `Prisma.TransactionClient`, (5) `moduleFormat` / `runtime` para Next.js 16 con el adapter de Neon.
  - Ya confirmado: `output` es obligatorio; el cliente se importa **desde la carpeta generada** (`<output>/client`), y la doc dice que importarlo de `@prisma/client` "ya no funciona" con este generador. Quedan por comprobar los puntos 2 a 5.
  - **Spike antes del codemod:** generar con el proveedor nuevo en una carpeta temporal y comprobar si existe `Prisma.dmmf` (o su equivalente) en tiempo de ejecución. La documentación consultada solo menciona `getDMMF` de `@prisma/internals` (API interna); **no está comprobado** que `Prisma.dmmf` exista con `prisma-client`. Si no existe, el plan B es generar el mapa de scope en un paso de build (script que parsea el DMMF y escribe un archivo versionado o generado) y que `prisma-tenant-assert.ts` lo importe.
- B) Generador:
  ```prisma
  generator client {
    provider = "prisma-client"
    output   = "../src/generated/prisma"
  }
  ```
  - `.gitignore` **ya** ignora `/src/generated/prisma` (línea 44), aunque hoy la carpeta no existe. Añadir `src/generated/` a `globalIgnores` de ESLint, a un `.prettierignore` (no existe; el script `format` recorre `src/**/*.{ts,tsx,json}`, así que formatearía o rechazaría lo generado) y a las exclusiones de cobertura. `tsc` sí debe incluirlo.
  - `postinstall` y `build` ya corren `prisma generate`. El job `integration` instala con `--ignore-scripts` y ya llama a `prisma generate` aparte; `test` y `architecture` instalan con scripts.
- C) **Codemod de imports:** script de un solo uso (no se commitea, o va a `scripts/ops/` si se reutiliza) que reemplaza `@prisma/client` por la ruta del cliente generado. Usar un alias estable: `@/generated/prisma/client` (la carpeta generada tiene subrutas `client`, `enums`, `models`), o un barrel `src/lib/db-types.ts` si conviene aislar el cambio. El diff debe ser **solo imports**. Casos a cubrir además de `from "@prisma/client"`: los tipos `import("@prisma/client").Prisma.TransactionClient` de varios tests y `vi.doMock("@prisma/client", …)` / `vi.doUnmock` en `src/lib/__tests__/prisma-tenant-assert.test.ts`.
- D) **`Prisma.dmmf`:** según el spike (A), adaptar `SCOPE_MAP` en `prisma-tenant-assert.ts` a la fuente equivalente. La red de seguridad **ya existe**: el test unitario `SCOPE_MAP (DMMF real)` fija el tamaño del mapa (93) y comprueba modelos concretos; SPEC-016 la endurece pero no es prerrequisito. Debe seguir en verde.
- E) **Mocks de tests:** actualizar los `vi.mock`/`vi.doMock` que apunten a la ruta vieja (hoy no hay `vi.mock("@prisma/client")`; sí un `vi.doMock`/`vi.doUnmock` en el test del tenant assert) y los mocks de `@/lib/prisma`.
- F) **Scripts fuera de `src/`** (`scripts/`, `prisma/seed*.ts`, `scripts/ops/*`, `test.ts` si sigue existiendo): mismo cambio de import. `prisma.config.ts` y los scripts `.mjs` no importan el cliente.

**No incluye (explícito):**
- Cambiar el adapter (`@prisma/adapter-neon`) ni su configuración de pool.
- Cambios de schema.
- Refactor de las extensiones más allá de lo necesario para compilar y pasar tests.

## 4. Reglas de negocio
- RN-1: El comportamiento de las cuatro extensiones (billing, tenant assert, postable account, tercero requerido) es idéntico antes y después: sus tests unitarios y de integración no cambian de aserción.
- RN-2: `SCOPE_MAP` nunca queda vacío (ver SPEC-016 RN-4).
- RN-3: El cliente generado no se commitea.

## 5. Asientos contables
No aplica. Invariante: el trigger de cuadre (ADR-060) y la cuantización siguen verificados por sus tests de integración.

## 6. Modelo de datos
Sin cambios de modelos. Cambia el bloque `generator`.

## 7. Contrato de servicio y actions
Sin cambios de firma. Archivos:
- `prisma/schema.prisma`
- ~160 archivos (solo imports)
- `src/lib/prisma.ts`, `src/lib/prisma-tenant-assert.ts`
- `eslint.config.mjs`, `.prettierignore` (crear), `vitest.config.ts` (exclusión de coverage)

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: `grep -rn '@prisma/client' src scripts prisma` devuelve 0 resultados en imports (salvo lo que la doc exija, justificado en la sección 11). Incluye los `import("@prisma/client")` de tipos y los `vi.doMock`.
- [ ] CA-2: `tsc --noEmit`, `vitest run` y `pnpm build` en verde. El número de tests es igual a la línea base.
- [ ] CA-3: El job `integration` pasa completo: migraciones desde cero, trigger de cuadre, correlativos y aislamiento (SPEC-016, si ya está mergeada).
- [ ] CA-4: El test unitario de `SCOPE_MAP` (tamaño y modelos centinela) pasa con el nuevo generador.
- [ ] CA-5: Smoke manual en preview de Vercel: crear factura, asiento y comprobante de retención en la empresa demo, sin errores en Sentry.

## 10. Plan de agentes
Sin prerrequisito duro. SPEC-016 mergeada es deseable (endurece el test del mapa), pero el test unitario actual ya cubre D.

## 11. Riesgos y preguntas abiertas
- R-1: Es el cambio de mayor superficie del paquete. Un PR exclusivo, sin nada más, y revisión de `security-agent` sobre el diff de `prisma-tenant-assert.ts`.
- R-2: Los tipos de `$extends` pueden cambiar. `src/lib/prisma.ts` hace `as unknown as PrismaClient`; mantener esa frontera para no propagar tipos a ~133 helpers.
- R-3: Bundle de servidor: comparar el tamaño de `.next/server` antes y después y registrarlo.
- R-4: Si `Prisma.dmmf` no existe con el generador nuevo, el plan B (mapa generado en build) añade un paso al pipeline; decidirlo con `arch-agent` antes de seguir.
- R-5: Con ESM y `output` en `src`, el tiempo de `tsc` y de los tests puede subir porque el cliente generado entra en el programa. Medirlo.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: `provider = "prisma-client-js"` sin `output`; 160 archivos con `from "@prisma/client"`; `Prisma.dmmf` se usa en `prisma-tenant-assert.ts` con `?? []`; `src/lib/prisma.ts` hace `as unknown as PrismaClient`.
- Corregido: `.gitignore` ya contiene `/src/generated/prisma`; no hace falta añadirlo.
- Corregido: hay un `vi.doMock("@prisma/client")` y `vi.doUnmock` (`prisma-tenant-assert.test.ts`) y varios `import("@prisma/client").Prisma.TransactionClient` en tests; la afirmación "0 mocks directos" era parcial.
- Corregido: no existe `.prettierignore` (el spec ya decía "crear si no existe"); `format` recorre `src/**`, así que es necesario.
- Corregido: la dependencia de SPEC-016 se relaja de "prerrequisito" a "deseable": el test de `SCOPE_MAP` que sirve de red de seguridad ya existe.
- Confirmado con documentación (Context7, `/prisma/web`): `prisma-client` es el reemplazo Rust-free y ESM de `prisma-client-js`; `output` es obligatorio; la ruta de import cambia a la carpeta generada (`./generated/prisma/client`) y "importing it from `@prisma/client` no longer works with the `prisma-client` generator"; `prisma-client-js` "will be removed in future releases".
- No comprobado: `Prisma.dmmf` con el generador nuevo (la documentación consultada no lo cubre); `Prisma.Decimal`, `Prisma.TransactionClient` y `moduleFormat`/`runtime` con Next 16 y el adapter de Neon (el ejemplo de `Prisma.Decimal` en la doc aún muestra `@prisma/client`). Es el trabajo del spike del punto A.

## 12. Cierre
