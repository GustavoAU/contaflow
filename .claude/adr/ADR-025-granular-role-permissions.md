# ADR-025 — Permisos Granulares por Rol (RolePermission)

**Estado:** Aceptado  
**Fecha:** 2026-05-07  
**Contexto:** Permisos multi-rol, transparencia de accesos, customización por empresa

---

## Problema

Los roles base de ContaFlow (OWNER/ADMIN/ACCOUNTANT/ADMINISTRATIVE/VIEWER/SENIAT) son rígidos.
Casos de uso legítimos requieren ampliar el acceso de un rol sin cambiar el rol base:
- Un contador que cubre al asistente administrativo temporalmente.
- Un administrativo que necesita ver reportes contables para su trabajo.

Además, los usuarios no saben qué módulos incluye su rol — falta de transparencia.

## Decisión

### 1. Tabla `RolePermission`
Grants ADITIVOS por empresa+rol+módulo. No restringe permisos base, solo amplía.

```
RolePermission {
  id, companyId, role: UserRole, module: String
  @@unique([companyId, role, module])
}
```

- **onDelete: Cascade** — se eliminan con la empresa.
- **OWNER/ADMIN**: acceso total fijo, no participan en grants.
- **SENIAT**: acceso de auditoría fijo por ADR-019.
- Roles grantables: ACCOUNTANT, ADMINISTRATIVE, VIEWER.

### 2. Módulos definidos en `src/lib/app-modules.ts`
`MODULE_KEYS` = accounting | invoicing | banking | payroll | inventory | orders | reports

Cada módulo tiene `baseRoles` (quién tiene acceso sin grants) y funciones puras:
- `hasBaseAccess(role, module)` — chequeo sin BD
- `canAccessModule(role, module, grants: Set<string>)` — con grants
- `toGrantSet(rows)` — convierte DB rows a Set "ROLE:module"

### 3. Nav grant-aware
`getNavItems(role, companyId, grants)` — El grant `ADMINISTRATIVE:accounting` añade
la sección Contabilidad al nav de ADMINISTRATIVE. El grant `ADMINISTRATIVE:reports`
añade la sección Reportes.

El layout carga grants vía `getCompanyGrants(companyId)` (cached con `unstable_cache`)
y los pasa al Navbar como `grantedModules: string[]`.

### 4. UI — PermissionsMatrix
Tabla rol × módulo en `/settings`. Checkboxes grises = base (fijo), verdes = grant editable.
Solo OWNER/ADMIN pueden modificar grants.

### 5. Invalidación de caché
`revalidatePath(`/company/${companyId}`)` después de grant/revoke — invalida el layout
y recarga grants en el próximo request.

## Alcance ACTUAL (v1)

Los grants afectan:
- ✅ Navegación (nav items visibles)
- ✅ Transparencia (qué puede hacer cada rol)

Los guards de Server Actions y page-level guards permanecen con `canAccess()` puro.
Ampliar grants a action-level es trabajo post-lanzamiento.

## Alternativas rechazadas

- **Roles personalizados**: Demasiado complejo pre-lanzamiento. Diferido post-launch.
- **Permisos por acción (CREATE/READ/UPDATE/DELETE)**: Granularidad excesiva; modelo
  de módulo es suficiente para los casos de uso actuales.
- **Modificar guards en 46 archivos de actions**: Riesgo pre-lanzamiento. El nav
  grant-aware da valor inmediato sin riesgo de regresión.

## Consecuencias

- Nueva tabla `RolePermission` en producción (migración aplicada 2026-05-07).
- `getNavItems` ya no es puramente síncrono a nivel de layout (carga grants async).
- `unstable_cache` por companyId — el caché se invalida con revalidatePath tras grant/revoke.
- **Deuda documentada**: action-level grant enforcement pendiente (TODO en guards).
