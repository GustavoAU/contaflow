---
id: SPEC-XXX
titulo: <nombre corto>
estado: BORRADOR   # BORRADOR → APROBADA → EN_CURSO → HECHA
fecha: YYYY-MM-DD
rama: feat/<slug>
arbol: "[N]"       # árbol de .claude/memory/decision-tree.md
zonas: []          # Z-1..Z-5 que toca, o []
adrs: []           # ADRs que aplican o que esta spec crea
---

# <Título>

## 1. Problema
Qué le pasa hoy al usuario (contador, dueño, auditor SENIAT) y por qué importa. Una o dos frases, sin solución todavía.

## 2. Base legal / contable
Norma que lo exige o lo limita (LIVA, LISLR, COT, PA-121, LOTTT, VEN-NIF…), con artículo.
Sin base legal → "Ninguna — decisión de producto".
Duda legal → **PREGUNTA PARA CONTADOR**. La spec no se aprueba con preguntas abiertas.

## 3. Alcance
**Incluye:**
- …

**No incluye (explícito):**
- …

## 4. Reglas de negocio
Numeradas, verificables y sin ambigüedad. Cada una se convierte en al menos un test.

- RN-1: …

## 5. Asientos contables
Solo si genera o modifica asientos. Una tabla por caso; cuentas con su código de la ontología.

| Caso | Cuenta | Débito | Crédito |
|---|---|---|---|

Invariante: débitos = créditos en cada caso, calculado con `Decimal.js`.

## 6. Modelo de datos
- Bloque Prisma propuesto, o "Sin cambios de schema".
- `onDelete: Restrict` en tablas contables; `@@unique` siempre con `companyId`.
- RLS: ENABLE + FORCE + policy `company_isolation` en la MISMA migración (ADR-007 A1-bis).
- Migración: `YYYYMMDD_<slug>` con el workflow manual de `CLAUDE.md` (`migrate dev` está roto).

## 7. Contrato de servicio y actions
Firmas TypeScript. ui-agent consume esto; la UI no se toca antes de que esté en verde.

```ts
// services
// actions — requireCompanyAction(companyId, { roles, limiter, captureNet }) (ADR-041)
```

- Roles:
- Limiter: `fiscal` (mutación) / `read` (lectura)
- AuditLog: acción `<NOMBRE>`, mismo `$transaction`, IP/UA (R-6)
- Período CLOSED: ¿bloquea? (R-3)

## 8. UI
- Rutas y componentes.
- Estados: vacío, cargando, error y éxito.
- Accesibilidad: labels asociados, orden de foco, `aria-busy` + `disabled={isPending}` en botones fiscales, teclado y contraste AA.
- Copy exacto de los mensajes al usuario.

## 9. Criterios de aceptación
Como casos de prueba. test-agent los escribe en RED antes de implementar.

- [ ] CA-1: Dado …, cuando …, entonces …
- [ ] CA-tenant: un usuario de otra empresa no puede leer ni escribir el recurso.
- [ ] CA-período: con período CLOSED la mutación devuelve error de negocio (si aplica).

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- …

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
