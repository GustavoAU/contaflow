# ADR-053 — Cuentas de "título" no admiten movimientos directos

**Estado:** Aceptado (decisión del dueño, 2026-09-22)
**Fecha:** 2026-09-22/23
**Relacionados:** R-1 (Libro Diario/Mayor), árbol [7] Schema Prisma, `prisma-billing-gate.ts` (precedente de extensión Prisma)

## Contexto

Feedback real de la tester Alpha: su plan de cuentas venezolano (formato ERP estándar) tiene cuentas de "título" (agrupan,
ej. "1.1 CIRCULANTE", nunca reciben un movimiento) y cuentas de "detalle" (ej. "Caja Principal", sí reciben movimientos).
ContaFlow era completamente plano: cualquier `Account` podía recibir un `JournalEntry`, sin distinción.

## Decisión

`Account.isPostable Boolean @default(true)`. Comprobado por grep exhaustivo: un `JournalEntry` **nunca** se crea suelto en
todo el repo (`transactionId` es `String` obligatorio en el schema) — siempre nace anidado dentro de
`prisma.transaction.create/update/upsert` (`entries: { create: [...] }`, confirmado en 15+ servicios). Por eso el bloqueo
vive en **un solo archivo nuevo**, `src/lib/prisma-postable-account-gate.ts`: una extensión de Prisma (`$extends`, mismo
patrón que `prisma-billing-gate.ts`) que intercepta esa operación en toda la app, extrae los `accountId` referenciados y
lanza si alguno tiene `isPostable: false` — sin tocar ninguno de esos 15+ servicios.

Fail-open explícito: un fallo de la consulta de verificación (cold start Neon, blip de red) nunca bloquea el 100% de los
asientos de la app — mismo criterio que `prisma-billing-gate.ts` (hallazgo de la auditoría de seguridad, corregido antes de
mergear).

### Importador de plan de cuentas (`src/modules/import/`)

El archivo real de la tester no tiene columna "tipo" (ASSET/LIABILITY/...) ni "nombre" separada — tiene "Descripción" (=
nombre) y clasifica implícitamente por el primer dígito del código (convención estándar venezolana: 1=Activo, 2=Pasivo,
3=Patrimonio, 4=Ingresos, 5-9=Gasto — ContaFlow no distingue Costo de Gasto, todo cae en EXPENSE). El importador ahora:
- infiere `tipo` del primer dígito cuando no hay columna "tipo" con un valor de más de 2 caracteres (una columna "Tipo"
  O/C de 1 carácter, presente en el archivo real, NUNCA puede ser un intento de escribir "ASSET" — el más corto es 5
  caracteres — así que se ignora y se infiere; una columna "tipo" explícita más larga, aunque inválida, SIGUE
  rechazándose con el mensaje de siempre, sin inferencia silenciosa que tape un error del usuario);
- mapea "G/M" → `isPostable` ("G" = título, todo lo demás = detalle, default seguro);
- usa "descripcion" como `nombre` cuando no hay columna "nombre" separada (sin duplicar en ambos campos);
- ignora sin fallar Nivel/Pre./Ter./C/C/Clase — significado sin confirmar, no se mapean.

## Fuera de alcance (otra tanda, decisión pendiente del dueño)

- **"Ter." (tercero obligatorio en una cuenta):** confirmado el significado (ej. Cuentas por Cobrar exige elegir a QUIÉN),
  implementación diferida. `Vendor`/`Customer` ya tienen rif/name/address y `Vendor.isSpecialContributor` ya determina
  retenciones ISLR/IVA — falta el vínculo Cuenta→tercero-obligatorio y decidir qué hacer con "socio/accionista" (no encaja
  en Customer ni Vendor hoy).
- **Pre., C/C, Clase:** significado sin confirmar. NO se mapea "Clase" a `Account.isMonetary` (hipótesis sin confirmar,
  consecuencia fiscal real de INPC si se equivoca).
- Caché del gate (TTL por companyId, como `billing-gate`) y auditoría exhaustiva de los 25+ servicios que arman `entries`
  (se revisó una muestra de 8, sin falsos negativos) — señalado por la auditoría de seguridad, no bloqueante.
