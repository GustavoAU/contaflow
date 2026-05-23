# ContaFlow — Guía de Despliegue y Smoke Test

> **Versión certificada:** ver `package.json → version` | **Plataforma destino:** Vercel + Neon (Tier 1)

---

## 1. Pre-requisitos

| Servicio | Plan mínimo | Notas |
|---|---|---|
| [Vercel](https://vercel.com) | Hobby o Pro | Pro requerido para dominio personalizado + Edge Functions ilimitadas |
| [Neon](https://neon.tech) | Free o Pro | Pro para PITR y >0.5 GB storage |
| [Clerk](https://clerk.com) | Free | Soporta hasta 10,000 MAU gratis |
| [Upstash Redis](https://upstash.com) | Free | Rate limiting; degradación graceful si no está |
| [Upstash QStash](https://upstash.com) | Free | Reintentos SENIAT; degradación graceful si no está |
| [Sentry](https://sentry.io) | Free | Opcional pero recomendado en producción |
| [Google AI Studio](https://aistudio.google.com) | Free | Para GEMINI_API_KEY (OCR, asistente, anomalías) |

---

## 2. Pasos de Despliegue

### 2.1 Preparar la base de datos (Neon)

```bash
# 1. Crear proyecto en Neon, copiar DATABASE_URL (pooled) y DATABASE_URL_DIRECT
# 2. Ejecutar migraciones en orden
cd <repo>
for f in prisma/migrations/*/migration.sql; do
  echo "Applying $f..."
  npx prisma db execute --url "$DATABASE_URL_DIRECT" --file "$f"
done

# 3. Verificar
npx prisma migrate status
```

### 2.2 Configurar variables de entorno en Vercel

Copiar `.env.example` y completar **todos** los campos marcados como OBLIGATORIO:

| Variable | Obligatorio | Cómo obtener |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon → Connection Details → **Pooled** |
| `DATABASE_URL_DIRECT` | ✅ | Neon → Connection Details → **Direct** (solo build/migrations) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | ✅ | Clerk Dashboard → API Keys |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL del dominio de producción (sin trailing slash) |
| `CERT_ENCRYPTION_SECRET` | ✅ | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `EMPLOYEE_PORTAL_SECRET` | ✅ | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `UPSTASH_REDIS_REST_URL` | Recomendado | Upstash Console → Redis → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Recomendado | Upstash Console → Redis → REST API |
| `QSTASH_TOKEN` | Recomendado | Upstash Console → QStash → Settings |
| `QSTASH_CURRENT_SIGNING_KEY` | Recomendado | Upstash Console → QStash → Settings |
| `QSTASH_NEXT_SIGNING_KEY` | Recomendado | Upstash Console → QStash → Settings |
| `GEMINI_API_KEY` | Recomendado | https://aistudio.google.com/apikey |
| `SENTRY_DSN` | Opcional | Sentry → Project Settings → DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | Opcional | Igual que `SENTRY_DSN` |
| `SENTRY_ORG` | Opcional | Sentry → Organization Settings → Slug |
| `SENTRY_PROJECT` | Opcional | Sentry → Project Settings → Slug |
| `SENTRY_AUTH_TOKEN` | Opcional | Sentry → Settings → Auth Tokens |
| `NOWPAYMENTS_API_KEY` | Diferido | Requiere dominio de producción para IPN |
| `NOWPAYMENTS_IPN_SECRET_KEY` | Diferido | — |

### 2.3 Configurar Clerk

1. En Clerk Dashboard → **Domains** → agregar dominio de producción
2. En **Paths** → confirmar que `/sign-in` y `/sign-up` coinciden con la app
3. En **Webhooks** → no se requieren para el lanzamiento inicial
4. En **Email Templates** → personalizar con branding ContaFlow (opcional)

### 2.4 Configurar QStash (para reintentos SENIAT)

1. Upstash → QStash → Endpoints → `Add Endpoint`
   - URL: `https://TU_DOMINIO/api/webhooks/seniat-report`
   - Retries: 3
   - Delay: 60s entre reintentos
2. Copiar las tres claves al dashboard de Vercel

### 2.5 Deploy a Vercel

```bash
# Vincular proyecto (primera vez)
npx vercel link

# Deploy a producción
npx vercel --prod
```

O vía GitHub Integration: Vercel detecta `vercel.json` y usa el comando `npm run build` definido ahí.

---

## 3. Smoke Test Post-Deploy

Ejecutar **en orden** en el entorno de producción. Cada paso es bloqueante.

### 3.1 Infraestructura

```
[ ] GET /api/health → 200 OK
    Esperar: { "ok": true, "db": true, "redis": true/false, "qstash": true/false }
    db: false → BLOQUEANTE — revisar DATABASE_URL
    redis/qstash: false → WARNING — rate limiting y SENIAT retry desactivados
```

### 3.2 Autenticación

```
[ ] /sign-up → crear usuario de prueba (usar email desechable)
[ ] /sign-in → iniciar sesión con el usuario creado
[ ] Clerk MFA → verificar que funciona si está habilitado
[ ] /sign-out → cerrar sesión → redirige a /
```

### 3.3 Empresa y configuración básica

```
[ ] Crear empresa de prueba (nombre, RIF: J-12345678-9)
[ ] Configurar período contable (año actual)
[ ] Agregar al menos una cuenta contable manualmente
[ ] Verificar que el plan de cuentas venezolano está disponible en seed
```

### 3.4 Facturación (módulo crítico)

```
[ ] Crear cliente de prueba
[ ] Crear factura de venta (producto + IVA 16%)
[ ] Verificar que el correlativo se generó: 00-00000001
[ ] Verificar que el asiento contable GL se creó automáticamente
[ ] Descargar PDF de la factura → verificar que se genera correctamente
[ ] Crear Nota de Crédito sobre esa factura
[ ] Verificar que NC reduce el saldo del cliente
```

### 3.5 Inventario

```
[ ] Crear ítem de inventario (Mercancía, con cuenta GL asignada)
[ ] Crear movimiento de ENTRADA (compra)
[ ] Verificar que el stock aumentó y el CPP se calculó
[ ] Verificar que se creó el asiento de inventario
```

### 3.6 Nómina

```
[ ] Crear empleado activo (con cédula, cargo, salario)
[ ] Crear corrida de nómina (período actual)
[ ] Aprobar la corrida → verificar asiento contable
[ ] Generar enlace portal del empleado → abrir /employee/[token]
    Verificar: datos del empleado visibles, recibo de pago visible, no requiere Clerk
```

### 3.7 Conciliación bancaria

```
[ ] Crear cuenta bancaria
[ ] Importar extracto CSV de ejemplo (>3 transacciones)
[ ] Verificar que las transacciones se importaron correctamente
[ ] Marcar al menos una como conciliada
```

### 3.8 Reportes fiscales

```
[ ] Forma 30 (IVA) → generar para período actual → descargar PDF
[ ] Libro de Ventas → verificar que incluye la factura del paso 3.4
[ ] Balance de Comprobación → verificar que cuadra (Débito = Crédito)
[ ] Dashboard → verificar que las tareas pendientes se muestran correctamente
```

### 3.9 Seguridad

```
[ ] Headers de seguridad → DevTools → Network → revisar response headers:
    ✓ Strict-Transport-Security: max-age=31536000; includeSubDomains
    ✓ X-Frame-Options: DENY
    ✓ X-Content-Type-Options: nosniff
    ✓ Content-Security-Policy: ... (verificar que está presente)
    ✓ Referrer-Policy: strict-origin-when-cross-origin
    ✓ Permissions-Policy: camera=(), microphone=(), ...
[ ] Intentar acceder a /company/ID-AJENO → debe redirigir o dar 404
[ ] Intentar /employee/token-invalido → debe dar 404
```

### 3.10 Portal del empleado

```
[ ] Ir a un empleado → clic en "Portal del empleado" → generar enlace
[ ] Copiar enlace → abrir en ventana incógnita (sin sesión Clerk)
[ ] Verificar: datos del empleado, última nómina, vacaciones visibles
[ ] Modificar el token en la URL → debe dar 404
```

---

## 4. Checklist de Variables Críticas

Antes del lanzamiento, verificar que estas variables NO son las de desarrollo:

```bash
# Verificar en Vercel → Settings → Environment Variables
[ ] DATABASE_URL → debe apuntar a Neon producción, NO a un branch de dev
[ ] CLERK_SECRET_KEY → debe ser sk_live_*, NO sk_test_*
[ ] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY → debe ser pk_live_*, NO pk_test_*
[ ] CERT_ENCRYPTION_SECRET → generado para producción (32 bytes hex)
[ ] EMPLOYEE_PORTAL_SECRET → generado para producción (32 bytes hex)
[ ] NODE_ENV → production (Vercel lo pone automáticamente)
```

> ⚠️ **ADVERTENCIA:** Si `CERT_ENCRYPTION_SECRET` cambia en producción, todos los
> certificados digitales almacenados quedarán indescifrables. Nunca rotar esta
> clave sin migrar los certificados primero.

> ⚠️ **ADVERTENCIA:** Si `EMPLOYEE_PORTAL_SECRET` cambia, todos los enlaces de
> portal generados previamente quedarán inválidos. Los empleados necesitarán
> nuevos enlaces.

---

## 5. Rollback

Si hay un problema grave post-deploy:

1. Vercel → Deployments → seleccionar el último deployment estable → **Promote to Production**
2. Si hubo migraciones de DB → ver `RUNBOOK.md → Sección 1` (PITR Neon)
3. Notificar en el canal de incidentes

---

## 6. Post-Lanzamiento (primeras 24h)

```
[ ] Verificar Sentry → sin errores críticos nuevos
[ ] Verificar Neon → latencia de queries < 100ms en p95
[ ] Verificar Upstash → Redis hits/miss ratio normal
[ ] Monitorear /api/health cada 5 minutos (configurar UptimeRobot o similar)
[ ] Crear primer usuario real → observar onboarding completo
```

---

*Ver también: `RUNBOOK.md` para procedimientos de recuperación ante incidentes.*
