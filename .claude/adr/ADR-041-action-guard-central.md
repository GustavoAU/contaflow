# ADR-041 — Guard central de Server Actions: `requireCompanyAction` + infraestructura canónica en `src/lib/`

- **Status**: ACEPTADO ✅
- **Date**: 2026-07-05
- **Author**: arch-agent
- **Criticality**: SECURITY + MANTENIBILIDAD — consolida el ritual ADR-004 (aislamiento multi-tenant) y R-6 (trazabilidad de red) en una fuente única
- **Rama de implementación**: `feat/action-infra-consolidation` (piloto: módulo `orders`)
- **Relacionados**: ADR-004 (companyId obligatorio), ADR-006 (authz destructivas), ADR-025 (grants granulares), R-6 (IP/UserAgent en AuditLog)

---

## Contexto

La auditoría integral del 2026-07-05 (hallazgo P1) midió duplicación estructural masiva en la capa de Server Actions:

| Síntoma | Medición |
|---|---|
| Ritual de guards (`auth()` → `checkRateLimit` → `companyMember.findFirst` → `canAccess`) | **167 apariciones en 60 archivos** `*.actions.ts` (~30 líneas c/u ≈ 5 000 líneas de boilerplate) |
| Derivación de `ipAddress`/`userAgent` (R-6) re-implementada por módulo | **44 archivos**, CON divergencia real de comportamiento |
| `types/action-result.ts` copiado por módulo | **32 copias** |
| `utils/action-errors.ts` copiado por módulo | **32 copias** |

La divergencia de IP no era cosmética: `payment-batch` usaba `x-forwarded-for.split(",")[0]` (**primera** IP de la cadena) mientras el resto usaba `.at(-1)` (**última**). La primera IP de `x-forwarded-for` es la que declara el cliente y **es manipulable** (el cliente puede enviar el header pre-poblado); la última es la añadida por NUESTRO proxy y no es spoofeable. La variante `[0]` de payment-batch era, por tanto, un **bug de trazabilidad**: el rastro de auditoría R-6 de los lotes de pago registraba una IP controlable por el atacante.

Riesgo estructural adicional: un cambio de política de guards (p. ej. cambiar la clave de rate limiting, endurecer el mensaje de error, añadir un check) hoy exige editar 60 archivos con 167 sitios — probabilidad alta de dejar sitios sin actualizar y de introducir divergencias nuevas.

---

## Decisión

### D-1 — Fuente única de tipos y mapeo de errores en `src/lib/`

- **`src/lib/action-result.ts`** → `ActionResult<T>` canónico:
  ```typescript
  type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };
  ```
- **`src/lib/action-errors.ts`** → `toActionError()` canónico (wrapper de `mapPrismaError` — los errores Prisma nunca llegan raw al cliente).
- Las 31+29 copias idénticas por módulo pasan a ser **re-exports de una línea** desde `src/lib/` — cero cambio de comportamiento, cero cambio en los imports existentes de cada módulo.

**Excepciones que CONSERVAN variante local** (divergen a propósito y se documentan aquí para que nadie las "unifique" por error):

| Módulo | Qué conserva | Por qué |
|---|---|---|
| `accounting` | `ActionResult` con `warning?`/`fieldErrors?` + `toActionError` con rama `ZodError` que puebla `fieldErrors` | Los formularios contables consumen errores por campo; aplanar a `string` rompería la UX de validación |
| `billing` | `toActionError` con rama `ZodError` (sin `fieldErrors`) | Traduce errores de validación de checkout a mensaje plano propio |
| `exchange-rates` | Helper extra `resolveIpUa` local; `toActionError` pasa a re-export | El helper local tiene lógica adicional propia del módulo; el mapeo de errores sí se unifica |

### D-2 — `src/lib/net-context.ts`: derivación canónica de IP/UserAgent (R-6)

`netContext()` es la ÚNICA implementación permitida para obtener `ipAddress`/`userAgent`:

```typescript
// Regla canónica:
ipAddress = x-real-ip ?? x-forwarded-for.split(",").at(-1)?.trim()
userAgent = userAgent.slice(0, 512)   // truncado a 512
```

**Regla de seguridad (normativa):** se usa `.at(-1)` — la **última** IP de `x-forwarded-for` es la añadida por nuestro proxy y no es falsificable por el cliente. La **primera** (`[0]`) viaja tal como el cliente la envíe y es spoofeable. La divergencia histórica de `payment-batch` (usaba `[0]`) queda clasificada como bug y corregida al migrar. Prohibido re-implementar esta derivación en módulos.

### D-3 — `src/lib/action-guard.ts`: `requireCompanyAction(companyId, opts)`

Helper que ejecuta el ritual completo **en orden canónico**:

1. `auth()` → sin sesión → error.
2. Rate limit con **`fiscalKey(companyId, userId)`** — clave compuesta empresa×usuario. Esto cierra la deuda técnica documentada en `ratelimit.ts`: la cuota deja de ser global por usuario y pasa a ser por empresa×usuario (un contador de un despacho no agota la cuota de otra empresa del mismo usuario).
3. `companyMember.findFirst` con `companyId` (IDOR guard ADR-004 — el `companyId` verificado sale de aquí, nunca del input).
4. `canAccess(role, opts.roles)`.
5. Opcional `opts.captureNet` → `netContext()` → `ipAddress`/`userAgent` (D-2).

Contrato de retorno:

```typescript
type GuardResult =
  | { ok: true; userId: string; role: CompanyRole; ipAddress?: string; userAgent?: string }
  | { ok: false; error: ActionResult<never> };
```

**Mensajes de error idénticos a los actuales** — "No autorizado" / "Empresa no encontrada o acceso denegado" / mensaje del limiter. Cero cambio observable para el cliente ni para los tests existentes.

### D-4 — Migración incremental, NO big-bang

- **Piloto migrado en esta rama:** módulo `orders` (7 actions).
- **Regla hacia adelante:** toda Server Action **NUEVA** usa `requireCompanyAction` obligatoriamente. Las existentes migran **módulo a módulo, en tasks separados** con su propio phase gate (tsc + vitest + security-agent), respetando la regla de aislamiento de scope de `CLAUDE.md`.
- **Invariante de seguridad:** el helper **NUNCA relaja un guard**. Checks adicionales — `ADMIN_ONLY` (ADR-006 D-1), step-up 2FA, `hasModuleAccess` (ADR-025) — van **DESPUÉS** del helper, en la action, no dentro del helper. `requireCompanyAction` es el piso mínimo, no el techo.

---

## Alternativas rechazadas

| Alternativa | Razón de rechazo |
|---|---|
| Middleware de Next.js | No ve el `companyId` del body de la action — no puede ejecutar el IDOR guard ADR-004; solo cubriría auth genérico |
| Decorador / HOF que envuelve la action completa | Oculta el flujo de control (el lector no ve dónde corta), y complica el testing de las ~160 actions existentes que mockean `auth()`/`prisma` directamente |
| Migrar los 60 archivos de una vez (big-bang) | Riesgo de regresión de authz inaceptable en pre-lanzamiento: 167 sitios tocados en un solo merge, imposible de auditar sitio por sitio |
| Dejar el status quo | 5 000 líneas duplicadas + divergencia real ya materializada (IP spoofeable en payment-batch) — el costo ya se pagó una vez |

---

## Consecuencias

**Positivas**
- Un cambio de política de guards = **1 archivo** (`action-guard.ts`), no 60.
- Rate limiting con clave `fiscalKey(companyId, userId)` — cuota justa por empresa×usuario; deuda de `ratelimit.ts` cerrada.
- Onboarding: un junior lee **1 línea** (`requireCompanyAction`) en vez de descifrar 30 líneas de ritual por action.
- Divergencia de derivación de IP **eliminada** en los módulos migrados; el bug `[0]` de payment-batch no puede reaparecer.
- `ActionResult`/`toActionError` con fuente única: los 32+32 archivos por módulo quedan como re-exports triviales.

**Negativas**
- Dos patrones conviven durante la migración (ritual inline vs helper). **Mitigación:** regla en `CLAUDE.md` — "toda action nueva usa `requireCompanyAction`, sin excepción" — y migración módulo a módulo en tasks con phase gate propio.
- Las excepciones de D-1 (`accounting`, `billing`, `exchange-rates`) exigen disciplina: quien vea la variante local debe leer este ADR antes de "unificarla".

**Regla operacional**
- `security-agent` sigue siendo trigger obligatorio en toda action nueva o modificada; el helper no sustituye la auditoría, la estandariza.
- Checks por encima del piso (ADMIN_ONLY, step-up, grants ADR-025) siempre después del helper — nunca parametrizados dentro para "ahorrar líneas".

---

## Archivos de implementación

- `src/lib/action-result.ts` — `ActionResult<T>` canónico
- `src/lib/action-errors.ts` — `toActionError()` canónico
- `src/lib/net-context.ts` — `netContext()` (regla `.at(-1)`, UA truncado a 512)
- `src/lib/action-guard.ts` — `requireCompanyAction(companyId, opts)`
- `src/modules/orders/actions/*.actions.ts` — piloto migrado (7 actions)
- `src/modules/*/types/action-result.ts` + `src/modules/*/utils/action-errors.ts` — re-exports de una línea (salvo excepciones D-1)
