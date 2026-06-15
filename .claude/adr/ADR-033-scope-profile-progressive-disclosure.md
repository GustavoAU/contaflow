# ADR-033 — ScopeProfile + Progressive Disclosure por Perfil de Empresa

**Fecha:** 2026-06-15  
**Estado:** Aceptado  
**Contexto:** Fase P — Fundación de Perfil (precondición de Tanda C / Bot híbrido)

---

## Contexto

ContaFlow sirve a dos perfiles muy distintos con el mismo nav:
- **SOLO / Freelancer:** empresa unipersonal sin empleados ni inventario físico — el módulo de Nómina y el de Inventario les queda grande al inicio.
- **EMPRESA:** empresa con empleados y/o inventario — necesita todos los módulos.
- **DESPACHO:** despacho contable con múltiples RIFs — Fase Despacho (ADR futuro).

El resultado es abrumamiento de UX para el usuario SOLO, sin poder crear tiers de precio distintos (contradice "todo incluido, sin costos ocultos"). Se necesita progressive disclosure basada en perfil, no en paywall.

## Decisión

### 1. Nuevo enum `ScopeProfile` en Prisma

```prisma
enum ScopeProfile {
  SOLO      // Sin empleados ni inventario — módulos bloqueados progresivamente
  EMPRESA   // Empresa con empleados y/o inventario — acceso completo
  DESPACHO  // Despacho contable — multi-RIF (reservado para Fase Despacho)
}
```

Campo en `Company`: `scopeProfile ScopeProfile?` — nullable (default null = no ha declarado perfil).

### 2. Mecanismo anti-repetición del onboarding

El campo `scopeProfile == null` ES la única fuente de verdad de "no ha declarado perfil todavía". No se usa cookie ni state local para esto. El onboarding banner del dashboard desaparece permanentemente cuando el campo se setea.

### 3. Flujo de captura (doble: pre + post registro)

**Pre-registro (Tanda C — bot):**  
El bot pregunta el perfil en la landing → resultado viaja como cookie `cf-onboarding-profile` + query param `/sign-up?plan=X&profile=Y` → `/company/new?profile=Y` pre-rellena el selector → al crear la empresa, `scopeProfile` queda escrito.

**Post-registro (este ADR):**  
Si el usuario llegó por otra vía (link directo, etc.) y `scopeProfile == null` → banner de onboarding en el dashboard del company layout pide declarar perfil. Al elegirlo, se llama `updateScopeProfileAction`.

### 4. Progressive disclosure en el nav (perfil SOLO)

Para `scopeProfile === 'SOLO'`, los ítems **Nómina** e **Inventario** en el nav se marcan con `locked: true`. En el Sidebar se renderizan con icono de candado y estilo reducido. Clicking navega a `/company/${companyId}/activate-modules` — una página minimal que explica y activa con un botón.

"Activar" llama a `updateScopeProfileAction('EMPRESA')` → revalida el layout → nav se expande.

Para `EMPRESA`, `DESPACHO` y `null`: nav completo sin restricciones.

### 5. Precios

El pricing sigue **plano** — todo incluido en todos los planes. `ScopeProfile` es una herramienta de UX, no de entitlement. No se usa para bloquear acceso real a funcionalidades (los Server Actions no cambian).

## Consecuencias

- **Positivo:** elimina abrumamiento del usuario SOLO sin fragmentar el pricing ni contradecir la marca.
- **Positivo:** el bot (Tanda C) puede pre-llenar el perfil desde la landing y pre-configurar el nav — doble uso de una sola pregunta.
- **Neutral:** `scopeProfile = null` durante el período de transición para todas las empresas existentes — el banner les pide declarar su perfil la primera vez que entran.
- **Acotado:** la capa de activación no toca Server Actions fiscales — solo afecta la visibilidad del nav y el onboarding. No hay enforcement en las rutas.
- **Diferido:** `DESPACHO` está en el enum pero su lógica específica (multi-RIF tier, billing, nav diferente) se implementa en Fase Despacho.

## Alternativas descartadas

- **Pricing por tiers de features (modelo QuickBooks):** contradice "sin costos ocultos", requiere entitlement matrix nuevo en middleware/actions/billing. Diferida como decisión de negocio cuando haya datos de uso.
- **`activatedModules String[]` por empresa:** más granular pero más complejo. Suficiente con SOLO→EMPRESA para v1.
