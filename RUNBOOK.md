# ContaFlow — Runbook Operacional

> **Versión:** 1.0 | **Última actualización:** 2026-05-22

---

## Objetivos de Recuperación

| Métrica | Objetivo |
|---|---|
| **RTO** (Recovery Time Objective) | < 4 horas |
| **RPO** (Recovery Point Objective) | < 1 hora |

Neon Postgres hace snapshots cada 5 minutos en el plan Pro. En caso de incidente grave, la pérdida máxima de datos es de 1 hora (configuración de retención de WAL).

---

## 1. Restauración de Base de Datos (Neon)

### 1.1 Restauración Point-in-Time (PITR)

```
Tiempo estimado: 15–30 minutos
Impacto: Downtime completo durante la restauración
```

**Pasos:**

1. **Acceder a la consola de Neon**
   - URL: https://console.neon.tech
   - Cuenta: `gustavou2186@gmail.com`

2. **Identificar el branch y el timestamp objetivo**
   - Ir a: Project → Branches → `main`
   - En el tab **Restore**, seleccionar "Point-in-time restore"
   - Elegir el timestamp justo antes del incidente (formato ISO-8601)

3. **Crear branch de restauración (sin afectar producción)**
   ```
   Branch name: restore-YYYYMMDD-HHMM
   Source: main @ <timestamp>
   ```

4. **Verificar la restauración**
   - Conectar al branch `restore-YYYYMMDD-HHMM` con `DATABASE_URL_DIRECT` apuntando al nuevo branch
   - Ejecutar verificaciones:
     ```sql
     -- Verificar integridad de tablas críticas
     SELECT COUNT(*) FROM "Invoice";
     SELECT COUNT(*) FROM "Transaction";
     SELECT COUNT(*) FROM "FiscalYearClose";
     SELECT MAX("createdAt") FROM "AuditLog";
     ```
   - Confirmar que el último `AuditLog` sea anterior al incidente

5. **Promover el branch restaurado a producción**
   - En Neon Console: Branch → "Set as primary" (o renombrar el branch original)
   - **ALTERNATIVA** más segura: actualizar `DATABASE_URL` y `DATABASE_URL_DIRECT` en Vercel para apuntar al branch restaurado

6. **Actualizar variables de entorno en Vercel**
   - Dashboard Vercel → Settings → Environment Variables
   - Actualizar `DATABASE_URL` con la connection string del branch restaurado (pooled)
   - Actualizar `DATABASE_URL_DIRECT` con la connection string directa (sin pooler)
   - **Redeploy** desde la consola de Vercel

7. **Ejecutar migraciones pendientes** (si el restore fue antes de alguna migración)
   ```bash
   npx prisma migrate resolve --applied <migration_name>
   ```

8. **Verificar health check post-restauración**
   ```bash
   curl https://tu-dominio.com/api/health
   # Esperado: { "ok": true, "db": "ok", ... }
   ```

### 1.2 Restauración desde Dump Manual

Si el PITR no es suficiente (ej. corrupción sistémica), usar el último dump manual:

```bash
# Restaurar dump completo
pg_restore \
  --host=<neon-host> \
  --port=5432 \
  --username=<neon-user> \
  --dbname=<dbname> \
  --no-owner \
  --role=<neon-user> \
  contaflow_backup_YYYYMMDD.dump

# Verificar
psql $DATABASE_URL_DIRECT -c "SELECT COUNT(*) FROM \"Invoice\""
```

---

## 2. Recuperación de PDFs desde Object Storage

```
Tiempo estimado: 5–15 minutos por archivo
Impacto: Sin downtime — solo recuperación de archivos
```

Los PDFs (facturas, retenciones, nóminas, reportes fiscales) se almacenan en **Vercel Blob Storage** con metadatos en la tabla `FiscalReport` (campo `storageKey` + `contentHash` SHA-256).

### 2.1 Recuperar PDF por storageKey

```sql
-- Encontrar el storageKey de un reporte perdido
SELECT id, "reportType", "storageKey", "contentHash", "createdAt"
FROM "FiscalReport"
WHERE "companyId" = '<company-id>'
  AND "reportType" = 'IVA_DECLARACION'
ORDER BY "createdAt" DESC
LIMIT 10;
```

```bash
# Descargar desde Vercel Blob
curl -H "Authorization: Bearer $BLOB_READ_WRITE_TOKEN" \
  "https://api.vercel.com/v1/blob/<storageKey>" \
  -o recuperado.pdf

# Verificar integridad SHA-256
sha256sum recuperado.pdf
# Comparar con el valor de contentHash en la BD
```

### 2.2 Regenerar PDF si el blob está corrupto o eliminado

1. Identificar el tipo de documento (`reportType`) y sus datos fuente en la BD
2. Re-ejecutar la generación:
   - Facturas → endpoint `/api/invoices/[id]/pdf`
   - Declaración IVA → endpoint `/api/fiscal/iva/[periodId]/pdf`
   - Nómina → endpoint `/api/payroll/[runId]/pdf`
3. El nuevo PDF se sube a Blob Storage y actualiza `FiscalReport.storageKey`

### 2.3 Inventario de blobs en Vercel

```bash
# Listar todos los blobs del proyecto
curl -H "Authorization: Bearer $BLOB_READ_WRITE_TOKEN" \
  "https://api.vercel.com/v1/blob?prefix=contaflow/" \
  | jq '.blobs[] | {url, size, uploadedAt}'
```

---

## 3. Procedimiento de Incidente

### Severidad 1 — DB caída o datos perdidos (RTO 4h)

```
[ ] 1. Detectar: alerta Sentry o /api/health devuelve 503 con "db": "error"
[ ] 2. Notificar al equipo (canal #incidentes)
[ ] 3. Identificar timestamp del último estado conocido-bueno en Sentry / logs Vercel
[ ] 4. Ejecutar PITR (Sección 1.1) con ese timestamp
[ ] 5. Verificar integridad post-restauración (queries de Sección 1.1, paso 4)
[ ] 6. Actualizar variables en Vercel + redeploy
[ ] 7. Verificar /api/health = 200
[ ] 8. Comunicar a usuarios afectados con timeline
[ ] 9. Post-mortem en 48h
```

### Severidad 2 — PDFs inaccesibles (RTO 4h)

```
[ ] 1. Detectar: error en descarga de PDF (Sentry `blob.download_error`)
[ ] 2. Consultar storageKey en FiscalReport (Sección 2.1)
[ ] 3. Intentar descarga directa y verificar hash
[ ] 4. Si corrupto: regenerar PDF (Sección 2.2)
[ ] 5. Notificar a empresa afectada
```

### Severidad 3 — Redis caído (sin bloqueo de negocio)

Rate limiting pasa a modo permisivo automáticamente (por diseño en `@/lib/ratelimit`).

```
[ ] 1. Verificar /api/health: campo "redis" = "error"
[ ] 2. En Upstash Console: reiniciar instancia o crear nueva
[ ] 3. Actualizar UPSTASH_REDIS_REST_URL en Vercel si cambió la URL
[ ] 4. Verificar /api/health = { "redis": "ok" }
```

---

## 4. Checklist de Prueba Mensual de Restauración

Ejecutar el **primer lunes de cada mes**:

```
[ ] 1. En Neon Console → crear branch temporal: test-restore-YYYYMM
       Source: main @ (hace 24 horas)

[ ] 2. Conectar al branch temporal (usar DATABASE_URL_DIRECT con el nuevo host)
       npx prisma db execute --url $TEST_DB_URL --stdin <<< "SELECT COUNT(*) FROM \"Invoice\""

[ ] 3. Verificar que el conteo es razonable (> 0 y < 10% de variación vs producción)

[ ] 4. Verificar tablas críticas:
       - Invoice, Transaction, FiscalYearClose, AuditLog, PayrollRun

[ ] 5. Eliminar el branch temporal

[ ] 6. Documentar resultado en tabla de abajo
[ ] 7. Si el test falla → escalar a incidente Severidad 1 inmediatamente
```

### Registro de pruebas

| Fecha | Ejecutado por | Timestamp restaurado | Resultado | Notas |
|---|---|---|---|---|
| — | — | — | — | Primer test pendiente |

---

## 5. Variables de Entorno Críticas

> **Nota:** Los valores reales están en el panel de Vercel. Nunca en código ni en este runbook.

| Variable | Descripción | Impacto si falta |
|---|---|---|
| `DATABASE_URL` | Neon pooled (PgBouncer) | App no arranca |
| `DATABASE_URL_DIRECT` | Neon direct (migraciones) | `prisma migrate` falla |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | PDFs no se generan |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | Pasa a modo permisivo |
| `QSTASH_TOKEN` | Cola QStash (SENIAT) | Retransmisión SENIAT falla |
| `QSTASH_CURRENT_SIGNING_KEY` | Verificación webhook | Webhooks rechazados |
| `SENTRY_DSN` | Observabilidad | Sin alertas de errores |
| `CERT_ENCRYPTION_SECRET` | Cifrado certificados digitales | Firma de documentos falla |

---

## 6. Contactos de Emergencia

| Servicio | Consola | Soporte |
|---|---|---|
| Neon Postgres | https://console.neon.tech | Discord Neon |
| Vercel | https://vercel.com/dashboard | https://vercel.com/support |
| Upstash Redis | https://console.upstash.com | Discord Upstash |
| Sentry | https://sentry.io | https://sentry.io/support |
| Clerk (Auth) | https://dashboard.clerk.com | support@clerk.com |

---

## 7. Scripts de Diagnóstico Rápido

```bash
# Health check completo
curl -s https://tu-dominio.com/api/health | jq .

# Verificar últimos errores en BD (últimos 50 AuditLog)
psql $DATABASE_URL_DIRECT -c "
  SELECT \"entityName\", action, \"createdAt\"
  FROM \"AuditLog\"
  ORDER BY \"createdAt\" DESC
  LIMIT 50;"

# Verificar SeniatSubmissions pendientes/fallidas
psql $DATABASE_URL_DIRECT -c "
  SELECT status, COUNT(*) 
  FROM \"SeniatSubmission\"
  WHERE status IN ('PENDING', 'FAILED')
  GROUP BY status;"

# Verificar FiscalReports sin contentHash (R-2 violation)
psql $DATABASE_URL_DIRECT -c "
  SELECT COUNT(*) FROM \"FiscalReport\"
  WHERE \"contentHash\" IS NULL;"
```
