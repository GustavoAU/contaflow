# ContaFlow — Diseño de Roles, Navegación y Permisos

_Versión 1.0 — 2026-04-13. Fuente: instrucciones técnicas + mockups UI aprobados por el usuario._

---

## 1. Jerarquía de roles

```
OWNER (5)        → acceso total, no editable
ADMIN (4)        → acceso total
ACCOUNTANT (3)   → solo módulos contables + lectura de Operaciones
ADMINISTRATIVE (2) → solo Operaciones + RRHH (Fase 28+)
VIEWER (1)       → lectura en su área asignada
```

`canAccess()` en `src/lib/auth-helpers.ts`. Grupos predefinidos:

```typescript
ROLES = {
  ALL:           ['OWNER','ADMIN','ACCOUNTANT','ADMINISTRATIVE','VIEWER'],
  ACCOUNTING:    ['OWNER','ADMIN','ACCOUNTANT'],
  OPERATIONS:    ['OWNER','ADMIN','ADMINISTRATIVE'],
  ADMIN_ONLY:    ['OWNER','ADMIN'],
  WRITERS:       ['OWNER','ADMIN','ACCOUNTANT','ADMINISTRATIVE'], // excluye VIEWER
}
```

**Regla fija v1**: Permisos NO configurables por empresa (Role Mapping con toggles postpuesto a versión futura — riesgo de misconfiguration de seguridad sin beneficio claro en v1).

---

## 2. Matriz de permisos por módulo

✓ = escritura | R = solo lectura | — = sin acceso

### Contabilidad
| Módulo | OWNER | ADMIN | ACCOUNTANT | ADMINISTRATIVE | VIEWER |
|---|---|---|---|---|---|
| Asientos contables | ✓ | ✓ | ✓ | — | R |
| Plan de cuentas | ✓ | ✓ | ✓ | — | R |
| Libros IVA | ✓ | ✓ | ✓ | — | R |
| Retenciones | ✓ | ✓ | ✓ | — | R |
| Activos fijos | ✓ | ✓ | ✓ | — | R |
| Ajuste Inflación (INPC) | ✓ | ✓ | ✓ | — | R |
| Cierre de Ejercicio | ✓ | ✓ | ✓ | — | R |
| Reportes legales | ✓ | ✓ | ✓ | — | R |
| **Inventario (valoración)** | ✓ | ✓ | R | — | R |

### Operaciones (Fase 28+)
| Módulo | OWNER | ADMIN | ACCOUNTANT | ADMINISTRATIVE | VIEWER |
|---|---|---|---|---|---|
| Facturas / CxC / CxP | ✓ | ✓ | R | ✓ | R |
| Pagos | ✓ | ✓ | R | ✓ | R |
| Conciliación bancaria | ✓ | ✓ | ✓ | R | R |
| **Inventario (movimientos físicos)** | ✓ | ✓ | — | ✓ | R |
| Nómina (Fase 23) | ✓ | ✓ | — | ✓ | R |

### Administración
| Módulo | OWNER | ADMIN | ACCOUNTANT | ADMINISTRATIVE | VIEWER |
|---|---|---|---|---|---|
| Miembros / roles | ✓ | ✓ | — | — | — |
| Settings empresa | ✓ | ✓ | R | — | — |
| Audit log | ✓ | ✓ | — | — | — |

---

## 3. Navegación por rol (sidebar)

### ACCOUNTANT
```
CONTABILIDAD
├── Asientos Contables
├── Plan de Cuentas
├── Períodos Contables
├── Libros IVA (Compras/Ventas)
├── Retenciones IVA/ISLR
├── IGTF
├── Activos Fijos
├── Ajuste Inflación (INPC)
├── Cierre de Ejercicio
└── Inventario (solo lectura — valoración + postear asientos)
REPORTES
├── Estado de Resultados
├── Balance General
└── Forma 30 SENIAT
```

### ADMINISTRATIVE
```
OPERACIONES
├── Inicio (dashboard)
├── Facturas (registro, sin causación)
├── Cuentas por Cobrar / Pagar
├── Pagos
└── Inventario (movimientos físicos: ENTRADA/SALIDA/AJUSTE)
BANCOS
└── Conciliación Bancaria (solo lectura)
RRHH
└── Nómina (Fase 23)
```

### OWNER / ADMIN
```
CONTABILIDAD   (todo lo de ACCOUNTANT)
OPERACIONES    (todo lo de ADMINISTRATIVE)
CONFIG.
├── Miembros
├── Settings empresa
└── Audit log
```

### VIEWER
Igual que su área asignada pero todos los módulos en modo lectura.

---

## 4. Dashboard por rol

### ACCOUNTANT dashboard
- Widgets contables: Tasa BCV, Períodos abiertos, Asientos del mes, Retenciones pendientes
- **Tareas pendientes** (widget clave — Fase 26B):
  - "X facturas sin causar" → alto
  - "Forma 30 feb vence" → alto
  - "Activos sin depreciar" → ok
  - **"X movimientos de inventario sin postear"** → (Fase 28D)
- No ve flujo de caja ni métricas operativas

### ADMINISTRATIVE dashboard
- Widgets operativos: Fact. por cobrar, Fact. por pagar, Flujo de caja, Pagos hoy
- Próximos vencimientos (facturas con fecha)
- **Alertas de inventario** (Fase 28D):
  - "Stock bajo en X productos"
  - "X movimientos pendientes de aprobación contable"
- NO ve valoración contable — solo cantidades físicas

### OWNER / ADMIN dashboard
- Vista integrada: métricas contables + operativas
- Tareas pendientes con etiquetas de área ("contab.", "bancos", "fiscal")

---

## 5. Inventario — flujo entre roles (Fase 28D)

**Separación crítica**: misma data, dos ángulos.

```
ADMINISTRATIVE                          ACCOUNTANT
─────────────────                       ──────────────────
Registra movimiento físico              Ve movimientos DRAFT como
(ENTRADA/SALIDA/AJUSTE)                 "tareas pendientes"
→ InventoryMovement.status = DRAFT          ↓
                                        Revisa valoración CPP
                                        Postea asiento automático:
                                          Déb: Costo de Ventas
                                          Cré: Inventario
                                        → status = POSTED
```

**Reglas de acceso en Server Actions:**
- `createMovementAction` / `voidDraftMovementAction` → `ROLES.OPERATIONS`
- `postMovementAction` / `voidPostedMovementAction` → `ROLES.ACCOUNTING`
- `getInventoryValuationAction` → `ROLES.ACCOUNTING` + ADMINISTRATIVE (lectura)

**ADMINISTRATIVE NO ve:**
- Libros IVA, Retenciones, IGTF (los genera el sistema al registrar facturas, pero el libro contable lo gestiona solo el ACCOUNTANT)
- Valoración monetaria del inventario (solo cantidades físicas)
- Asientos generados

---

## 6. Company Settings (estructura)

Dos columnas:
- **Parámetros Contables (VEN-NIF)**: Plan de Cuentas Maestro, Cierre de Ejercicio, Ajuste de Inflación (INPC)
- **Parámetros Operativos (Administración)**: Medios de Pago Zelle/Carteras, Nómina LOTTT, Libros IVA/Retenciones

Acceso: OWNER ✓ | ADMIN ✓ | ACCOUNTANT R | resto —

---

## 7. Errores de mockup corregidos

- **Image 6 (mockup Gemini)**: mostraba Libros IVA / Retenciones / IGTF en sidebar de ADMINISTRATIVE → **INCORRECTO**. ADMINISTRATIVE no ve esos módulos. Fueron quitados en la corrección del usuario.
- **Role Mapping con toggles** (Image 8): postpuesto a versión futura. No implementar en v1.

---

## 8. Implementación actual (2026-04-13)

- ✅ Fase 28A: Schema `UserRole` + `auth-helpers.ts` + `canAccess()`
- ✅ Fase 28B: `getNavItems(role)` + Navbar agrupado + badge "Pronto" para Inventario
- ✅ Fase 28C: Guards `canAccess()` en 13 action files + dashboard dinámico por rol
- ⏳ Fase 28D: Módulo Inventario (ADR-011, security audit pre-implementación completos)
