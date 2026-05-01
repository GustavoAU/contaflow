# ContaFlow — Decision Tree
_Punto de entrada obligatorio en cada sesión. Lee esto ANTES que cualquier otro archivo._
_Última actualización: 2026-04-30_

> **Versiones de referencia:** Next.js 16.2.4 | Prisma 7.4.1 | Zod 4 | Vitest 4
> Si el `package.json` real difiere de estas versiones → actualizar `skills-discovered.md`
> antes de implementar. Un cambio de major en Prisma invalida los patterns tipo A y B.

---

## PASO 1 — ¿Dónde estoy?

```
contaflow-context-v3.md → Sección "Estado Activo" (primeras ~50 líneas)
```

Lee solo el bloque **Estado Activo**. No leas el historial archivado a menos que el handoff lo indique.

---

## PASO 2 — ¿Qué voy a tocar? Encuentra tu árbol.

| Si tu tarea involucra… | Árbol | Archivos a leer | Skills relevantes |
|---|---|---|---|
| Correlativos (controlNumber, voucherNumber) | **[1]** | Z-1 en CLAUDE.md | B1 |
| IVA, IGTF, ISLR, alícuotas, FiscalCalculator | **[2]** | Z-2 en CLAUDE.md | C1, C2, C3 |
| Server Action nueva o modificada | **[3]** | R-6 + security-agent trigger | B2, D1 |
| Cierre de período, FiscalYearClose, INPC | **[4]** | Z-3 en CLAUDE.md | — |
| Transmisión SENIAT, SeniatSubmission, QStash | **[5]** | Z-4 en CLAUDE.md | D2 |
| Certificados digitales, firma, P12 | **[6]** | Z-5 en CLAUDE.md | — |
| Schema Prisma (modelo nuevo o campo) | **[7]** | R-1 + ADR relevante + DECISIONS.md | A1 |
| Exportación fiscal (Excel, PDF, libro diario/mayor) | **[8]** | DECISIONS.md → exceljs | E1 |
| Nómina (PayrollRun, cálculos LOTTT) | **[9]** | quick-reference.md | C3 |
| UI / componente React / formulario fiscal | **[10]** | DECISIONS.md → Neon cold start | E2 |
| Bug, fix TS, tests, docs | **[11]** | Nada extra | — |
| **Toca 2+ dominios o no encuentro mi caso** | **[∞]** | R-1 → R-7 completo (fallback) | Leer todos los relevantes |

---

## Árbol [1] — Correlativos

```
OBLIGATORIO:
  ✓ isolationLevel: 'Serializable'
  ✓ Capturar P2002 con mensaje de negocio (no exponer raw)
  ✓ @@unique([companyId, invoiceType]) ya existe → no duplicar

CHECKLIST:
  [ ] ¿Usa Skill B1 como base?
  [ ] ¿El catch de P2002 incluye meta.target.includes("controlNumber")?
  [ ] ¿El mensaje de error dice "Error transitorio — intenta de nuevo"?
  [ ] ¿El botón de submit tiene disabled={isPending} + aria-busy?

ARCHIVOS RELEVANTES:
  src/modules/invoices/services/ → getNextControlNumber
  src/modules/retentions/services/ → getNextVoucherNumber
```

---

## Árbol [2] — Cálculo de Impuestos

```
OBLIGATORIO:
  ✓ Decimal.js absoluto → number nativo = bug garantizado
  ✓ Alícuotas desde enums, nunca hardcoded en inline
  ✓ IGTF solo si: currency !== VES  OR  (isSpecialContributor AND currency === VES)
  ✓ luxuryGroupId linkea IVA_ADICIONAL ↔ IVA_GENERAL → no romper

ALÍCUOTAS CANÓNICAS (Skills C1):
  IVA_GENERAL:   Decimal('0.16')
  IVA_REDUCIDO:  Decimal('0.08')
  IVA_ADICIONAL: Decimal('0.15')  → lujo → se suma a GENERAL → total 31%
  EXENTO:        Decimal('0')
  IGTF:          Decimal('0.03')

CHECKLIST:
  [ ] ¿Cero number nativo en variables de dinero?
  [ ] ¿Decimal.js en TODA operación aritmética?
  [ ] ¿Condición IGTF verificada contra isSpecialContributor + currency?
  [ ] ¿taxBase.multipliedBy() en vez de taxBase * alicuota?
```

---

## Árbol [3] — Server Action Nueva / Modificada

```
OBLIGATORIO (security-agent trigger):
  ✓ Auth verificado ANTES de lógica de negocio
  ✓ IDOR guard: companyMember.findFirst({ where: { companyId, userId } })
  ✓ .safeParse() con Zod antes de usar inputs
  ✓ ipAddress + userAgent en AuditLog (R-6)
  ✓ AuditLog en mismo $transaction que la mutation
  ✓ Rate limiting con checkRateLimit antes de DB
  ✓ Errores Prisma mapeados → nunca raw al cliente

🛑 HARD STOP — AUDITLOG OBLIGATORIO:
  Si el $transaction no contiene tx.auditLog.create(...) → DETENER.
  No continuar. Avisar al usuario antes de escribir más código.
  Una mutación financiera sin AuditLog es un bug de seguridad y compliance (R-6).
  No hay excepción. No hay "lo añado después".

TEMPLATE BASE (Skill B2):
  1. auth() → userId o return { error: "Unauthorized" }
  2. companyMember.findFirst → member o return { error: "Forbidden" }
  3. canAccess(member.role, ROLES.X)
  4. schema.safeParse(input) → validatedData o return { error: ... }
  5. checkRateLimit(userId, limiters.fiscal)
  6. prisma.$transaction([mutation + auditLog])  ← auditLog NO es opcional

CHECKLIST:
  [ ] ¿Security-agent activado para auditar?
  [ ] ¿companyId viene del member verificado, no del input directo?
  [ ] ¿AuditLog dentro del $transaction? (HARD STOP si no)
  [ ] ¿IP/UA capturados de x-forwarded-for / x-real-ip?
```

---

## Árbol [4] — Cierre de Período

```
OBLIGATORIO:
  ✓ Período CLOSED → ERROR 403 inmediato en cualquier mutación
  ✓ Excepción única: ADR-015 (ajuste en período actual con FK al original)
  ✓ FiscalYearClose + INPCService: Serializable SIEMPRE
  ✓ PeriodSnapshot antes de cerrar

CHECKLIST:
  [ ] ¿Verificación status === 'CLOSED' → return 403 antes de cualquier write?
  [ ] ¿Si es ajuste post-cierre, aplica ADR-015?
  [ ] ¿isolationLevel: Serializable en la transacción de cierre?
```

---

## Árbol [5] — Transmisión SENIAT / QStash

```
OBLIGATORIO (Z-4):
  ✓ Verificar idempotencia: status IN [SENT, ACKNOWLEDGED] antes de procesar
  ✓ Comentar: // Idempotencia PA-121: descarta reintentos duplicados de QStash
  ✓ Validar firma QStash antes de procesar payload
  ✓ SeniatSubmission en mismo $transaction que la factura/NC/ND

CHECKLIST:
  [ ] ¿Idempotencia comentada explícitamente en el código?
  [ ] ¿Firma QStash validada?
  [ ] ¿SeniatSubmission creado en mismo $transaction?
  [ ] ¿SENIAT caído → status PENDING (QStash reintenta)?
```

---

## Árbol [6] — Certificados Digitales

```
OBLIGATORIO (Z-5):
  ✓ encryptedP12 NUNCA en ningún SELECT al cliente → select explícito siempre
  ✓ buf.fill(0) post-descifrado en DocumentSigningService → nunca omitir
  ✓ CERT_ENCRYPTION_SECRET nunca en logs ni respuestas

CHECKLIST:
  [ ] ¿SELECT excluye encryptedP12?
  [ ] ¿buf.fill(0) presente después de usar el certificado?
  [ ] ¿Ningún log loguea el secret?
```

---

## Árbol [7] — Schema Prisma

```
REGLAS:
  ✓ onDelete: Restrict en TODAS las tablas contables
  ✓ AuditLog en mismo $transaction que la mutation
  ✓ Soft delete (deletedAt) en entidades con relevancia fiscal
  ✓ prisma migrate dev ESTÁ ROTO → workflow manual (ver CLAUDE.md → Prisma / DB)

WORKFLOW OBLIGATORIO:
  1. Crear prisma/migrations/YYYYMMDDHHMMSS_nombre/migration.sql manualmente
  2. npx prisma db execute --file ...
  3. npx prisma migrate resolve --applied ...
  4. npx prisma generate
  5. Reiniciar npm run dev

CHECKLIST:
  [ ] ¿onDelete: Restrict en relaciones contables?
  [ ] ¿Campo deletedAt si entidad tiene relevancia fiscal?
  [ ] ¿Workflow manual usado (no prisma migrate dev)?
  [ ] ¿npx prisma generate + reinicio de servidor?
```

---

## Árbol [8] — Exportación Fiscal (Excel / PDF)

```
REGLAS (DECISIONS.md → exceljs):
  ✓ import("exceljs") dinámico → no import estático (SSR)
  ✓ import type ExcelJS from "exceljs" para tipos
  ✓ buffer as unknown as Parameters<typeof wb.xlsx.load>[0] para el tipo Buffer
  ✓ Webpack fallbacks en next.config.ts: { fs: false, path: false, ... }
  ✓ Reportes fiscales → Object Storage (R-2). Solo metadatos + contentHash en DB

CHECKLIST:
  [ ] ¿Import dinámico de exceljs?
  [ ] ¿contentHash (SHA256) guardado en DB junto a metadatos?
  [ ] ¿Contenido del reporte en Object Storage, no en DB?
```

---

## Árbol [9] — Nómina

```
REGLAS LOTTT:
  ✓ Prestaciones: 15 días/trimestre + intereses BCV
  ✓ Vacaciones: 15 días + 1 día adicional/año
  ✓ Utilidades: mínimo 15 días
  ✓ Decimal.js en TODOS los cálculos de nómina

VER: quick-reference.md para cuentas contables de nómina
```

---

## Árbol [10] — UI / Formularios Fiscales

```
REGLAS:
  ✓ disabled={isPending} + aria-busy={isPending} en botones fiscales
  ✓ aria-label dinámico: isPending ? "Procesando..." : "Emitir"
  ✓ useTransition para forms con Zod tipado (nuestro caso)
  ✓ useActionState solo para forms simples sin Zod

COLD START NEON:
  ✓ void prisma.$queryRaw`SELECT 1`.catch(() => {}) en dashboard layout
  ✓ connectionTimeoutMillis: 10_000 en pg.Pool (ya configurado)

CHECKLIST:
  [ ] ¿Botón con disabled={isPending}?
  [ ] ¿aria-busy presente?
  [ ] ¿Spinner visible durante isPending?
```

---

## Árbol [11] — Bug / Fix TS / Tests / Docs

```
No requiere lectura de archivos adicionales.
Verificar antes de cerrar:
  [ ] tsc --noEmit = 0 errores
  [ ] npx vitest run = 0 fallos
```

---

## PASO 3 — Handoff de sesión anterior

Al iniciar, busca en `contaflow-context-v3.md` el último bloque:

```markdown
<!-- HANDOFF YYYY-MM-DD Fase XX -->
```

Si existe → leer completo. Contiene decisiones pendientes y árbol sugerido para esta sesión.

---

## PASO 4 — Phase Gate (antes de terminar)

```
[ ] tsc --noEmit → exit 0
[ ] npx vitest run → 0 failures
[ ] Si hay nueva regla/patrón → documentar en skills-discovered.md (5 min)
[ ] Si hay decisión arquitectónica → ADR nuevo o actualizar DECISIONS.md
[ ] Escribir bloque <!-- HANDOFF --> al final de contaflow-context-v3.md
```
