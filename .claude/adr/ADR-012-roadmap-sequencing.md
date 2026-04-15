# ADR-012 — Secuencia de Roadmap: NOM-C/D/E primero, Fases 35-36 post-lanzamiento

**Fecha:** 2026-04-15
**Estado:** DECIDIDO
**Contexto:** Sesión de planificación estratégica tras completar NOM-B (1098 tests GREEN)

---

## Decisión

Las Fases 35A–36B (Vendor/Customer formal, P2P completo, O2C completo) se difieren a **post-lanzamiento**. La secuencia pre-lanzamiento es:

```
NOM-C → NOM-D → NOM-E → Fase 35A (simplificada) → LAUNCH → feedback → 35B/C/36A/B
```

---

## Motivación

### Por qué NOM-C/D/E primero

1. **Mayor ROI en mercado venezolano.** Toda empresa venezolana con empleados necesita nómina legal (IVSS, Banavih, INCES, ISLR, prestaciones, ARC). Una nómina sin motor de cálculo no es producto.
2. **Obligatoriedad legal LOTTT.** Prestaciones sociales (NOM-D) y reportes SENIAT como Forma 14-02 (NOM-E) son mandatorios — no opcionales.
3. **Coherencia con NOM-A/B ya entregados.** El wizard de config y el módulo de empleados son la entrada del embudo. Sin NOM-C el embudo no cierra.

### Por qué diferir Fases 35B–36B

1. **YAGNI.** Fase 28 ya tiene `QuotationService` + `OrderService` (45 tests). Reconstruir esto como módulo P2P formal antes de validar con clientes reales es especulativo.
2. **Riesgo de migración.** `Invoice.vendorName: String` → `vendorId: FK Vendor` requiere backfill de datos históricos de todos los tenants existentes. Este riesgo no se justifica sin demanda confirmada de clientes.
3. **Tiempo de desarrollo.** Las 5 fases (35A–36B) implicarían ~150 tests adicionales y múltiples semanas de desarrollo. El tiempo es mejor invertido en cerrar NOM y llegar al mercado.

### Por qué Fase 35A simplificada sí entra pre-launch

La entidad `Vendor` / `Customer` como FK opcional en `Invoice` (sin el workflow P2P completo) resuelve la brecha real del "círculo de confianza" sin el riesgo de la migración: las FKs son nullable, los campos `String` históricos se preservan, no hay backfill destructivo.

---

## Consecuencias

### Positivas
- Foco: el equipo (un desarrollador + Claude) no dispersa esfuerzo en features sin validar
- Lanzamiento más rápido: NOM-C/D/E → 35A simplified → launch en lugar de NOM + 5 fases operacionales
- Feedback real antes de invertir en P2P/O2C completo

### Negativas / Trade-offs
- Si un cliente enterprise exige P2P formal en el onboarding, no estará disponible
- La integración Inventario ↔ Compras sigue siendo manual hasta 35C (GoodsReceipt)

### Restricciones operativas

- **No iniciar 35B, 35C, 36A, 36B** hasta que exista al menos 1 cliente de pago y su feedback lo justifique — documentar en `contaflow-contract.md` como condición YAGNI
- **Fase 35A simplificada:** solo `Vendor` y `Customer` como entidades, FK nullable en `Invoice`, sin `PurchaseOrder` / `GoodsReceipt` / `SalesOrder`
- **Domain Events:** arquitectura propuesta en el ROADMAP_OPERACIONAL es correcta para el futuro; documentar como patrón elegido pero no implementar hasta que los bounded contexts lo requieran

---

## Alternativas descartadas

| Alternativa | Por qué descartada |
|---|---|
| Implementar 35A–36B completo antes de launch | YAGNI + riesgo migración + tiempo |
| Implementar solo 35A formal (con workflow P2P básico) | El workflow sin GoodsReceipt (35C) queda incompleto; mejor hacer 35A como FK nullable |
| Saltar NOM-D/E e ir directo a launch con NOM-C | Nómina sin prestaciones/ARC no es usable legalmente en Venezuela |

---

## Revisión

Esta decisión se revisa cuando:
- Se firma contrato con cliente que requiere módulo P2P explícitamente
- NOM-E está completado y el product está en beta con usuarios reales
- El feedback de clientes muestra pain point concreto en gestión de proveedores/clientes
