# ContaFlow — Decisions Log

Registro de decisiones de dependencias, configuración y arquitectura técnica.
Este archivo contiene el **por qué** de cada decisión. `CLAUDE.md` contiene el **qué hacer**.

Un agente no necesita leer este archivo para implementar una fase normal.
Leerlo cuando: toque una dependencia listada aquí, evalúe cambiar una librería, o enfrente un CVE.

---

## Dependencias

### `next` — upgrade 16.1.6 → 16.2.4 (2026-04-27)

Resuelve 5 CVEs HIGH: CSRF bypass en Server Actions (null origin), HTTP request smuggling, DoS en Server Components, DoS por image cache/buffer ilimitado. Bump de patch dentro de v16 — sin breaking changes.

---

### `xlsx` → `exceljs` (2026-04-27)

`xlsx` eliminado completamente. CVEs de prototype pollution + ReDoS (GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9) afectan parsing de archivos maliciosos — riesgo real en `ImportService` y `AccountsImporter`.

Migración cubre 7 archivos: `ImportService.ts`, `ImportService.test.ts`, `AccountsImporter.tsx`, `JournalExportButton.tsx`, `LedgerExportButton.tsx`, `InvoiceBook.tsx`, `PayrollRunDetail.tsx`.

**Notas de integración con Next.js:**

- Webpack fallback en `next.config.ts`: `{ fs: false, path: false, child_process: false, net: false, tls: false }`
- `import type ExcelJS from "exceljs"` para tipos; `import("exceljs")` dinámico en runtime
- El tipo `Buffer` de exceljs difiere del Node.js moderno → usar `buffer as unknown as Parameters<typeof wb.xlsx.load>[0]`
- exceljs introduce `uuid` moderate (uso interno, bajo riesgo — no exponemos el parámetro `buf`)

---

### `@hono/node-server` moderate — ignorado intencionalmente

Está dentro de `@prisma/dev` (Prisma Studio) — exclusivamente herramienta de desarrollo. El fix requeriría bajar Prisma de 7.4.1 a 6.x: breaking change inaceptable. El middleware bypass de `serveStatic` no afecta producción.

---

## Configuración de infraestructura

### Robustez ante cold starts de Neon (2026-04-29)

**Contexto:** Neon serverless tiene cold starts de 300–800ms tras inactividad. El riesgo no es fiscal (QStash garantiza entrega al SENIAT) sino de UX: el usuario puede hacer doble clic pensando que su acción no fue registrada, generando documentos duplicados.

**Fix 1 — `disabled` + `aria-busy` en formularios fiscales**

Todo botón de submit en formularios de documentos fiscales (factura, NC, ND, retención) debe estar deshabilitado durante la transición:

```typescript
const [isPending, startTransition] = useTransition();

const handleSubmit = () => {
  startTransition(async () => {
    const result = await createInvoiceAction(data);
    // handle result
  });
};

<button
  onClick={handleSubmit}
  disabled={isPending}
  aria-busy={isPending}
  aria-label={isPending ? "Procesando factura..." : "Emitir Factura"}
>
  {isPending ? <Spinner /> : "Emitir Factura"}
</button>
```

**Fix 2 — Connection warming en dashboard layout**

En `src/app/(dashboard)/layout.tsx`, fire-and-forget para despertar el pool antes de que el usuario llegue a un formulario:

```typescript
// Fire-and-forget — no bloquea render del layout. Corre solo en servidor.
// Reduce probabilidad de cold start cuando el usuario llega a un formulario fiscal.
void prisma.$queryRaw`SELECT 1`.catch(() => {
  /* silencioso */
});
```

**Fix 3 — `connectionTimeoutMillis` explícito en `pg.Pool`**

En `src/lib/prisma.ts`:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000, // cubre cold start de Neon (default de pg es 0 = infinito)
  idleTimeoutMillis: 20_000, // libera conexiones idle rápido — Neon cobra por conexión activa
  max: 5, // Neon free tier: 5 conexiones simultáneas
});
```

**Fix 4 — P2002 en correlativo con mensaje de negocio**

Si Neon cae durante una transacción `Serializable` con correlativo y el usuario reintenta, puede colisionar el `@@unique`. Capturar explícitamente en cualquier action que genere correlativo:

```typescript
 catch (e) {
  if (isPrismaError(e, "P2002") && (e.meta?.target as string[])?.includes("controlNumber")) {
    return { error: "Error transitorio — intenta de nuevo. El documento no fue creado." };
  }
  throw e;
}
```

---

### Advisory locks (Opción B) — PENDIENTE post-lanzamiento

**Propuesta:** reemplazar `isolationLevel: Serializable` en transacciones de correlativos por `pg_advisory_xact_lock(abs(hashtext(companyId || invoiceType)))` con `READ COMMITTED`.

**Ventaja:** serializa solo las transacciones que compiten por el mismo correlativo en lugar de todo el snapshot — menor contención bajo carga alta.

**Requisitos técnicos:**

- Requiere `tx.$executeRaw` (Prisma no tiene soporte nativo)
- Compatible con PgBouncer transaction mode (advisory xact locks se liberan al finalizar la transacción)

**Decisión:** No implementar hasta que métricas post-lanzamiento muestren contención real (`P2034` frecuentes en logs de Neon).

**Excepción permanente:** `FiscalYearClose`, `INPCService` e `InventoryAccounting` deben quedarse en `Serializable` siempre — protegen lecturas agregadas, no solo correlativos.

---

## Decisiones de arquitectura rápidas

### ¿Por qué `@prisma/adapter-pg` y no el driver nativo Prisma para Neon?

El adapter-pg con `pg.Pool` da control explícito sobre `connectionTimeoutMillis`, `idleTimeoutMillis` y `max`. El driver nativo de Neon gestiona el pool internamente sin esos knobs — problema en free tier donde el límite de conexiones simultáneas es 5.

### ¿Por qué QStash para transmisión al SENIAT y no un cron job?

QStash garantiza exactly-once delivery con backoff exponencial y dead-letter queue. Un cron job en Vercel/serverless no garantiza que el job complete si la función expira antes de que el SENIAT responda. Referencia: ADR-019.

### ¿Por qué modelo híbrido demo/oficial para certificados digitales?

Certificados oficiales (PSC World/SUSCERTE) tienen burocracia y costo — fricción de onboarding inaceptable para PYMEs. El modelo híbrido permite onboarding gratis con certificado autofirmado (identifica a la empresa, no a ContaFlow) y upgrade a certificado oficial cuando el cliente lo necesite. Referencia: ADR-020.

### ¿Por qué `prisma migrate dev` está roto?

Las carpetas de migración con prefijo de 8 dígitos (YYYYMMDD) son interpretadas como medianoche (YYYYMMDD000000). Cuando hay múltiples migraciones del mismo día con dependencias entre sí, el shadow DB las aplica en orden alfabético en lugar del orden de dependencias, causando P3006. Solución: usar timestamps completos (YYYYMMDDHHMMSS) en carpetas con dependencias del mismo día. Las migraciones existentes ya tienen este fix aplicado — no revertir.
