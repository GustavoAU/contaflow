---
id: SPEC-007
titulo: Toda entrada de inventario lleva contrapartida (nunca un asiento de una sola línea)
estado: BORRADOR   # decisión contable resuelta por la contadora 2026-10-04; falta aprobar alcance y la PA-1
fecha: 2026-10-04
rama: feat/spec-007-entrada-inventario-contrapartida
arbol: "[3]"
zonas: []
adrs: [ADR-058]
---

# Toda entrada de inventario lleva contrapartida (nunca un asiento de una sola línea)

## 1. Problema
`InventoryAccountingService.postMovement` crea, para una ENTRADA "standalone" (sin factura y sin cuenta de contrapartida), un asiento de **una sola línea**: Dr Inventario. Su Σ es distinto de 0 por diseño (el código lo marca con `expectBalanced: false` y comenta que el crédito "se genera" en otro asiento). Un asiento así viola la partida doble y el trigger de cuadre de la SPEC-001 lo rechazaría.

## 2. Base legal / contable
Decisión de la contadora (2026-10-04, vía el usuario):
- Se usa **inventario continuo** (perpetuo): mantiene actualizado el saldo del inventario. Es lo que ContaFlow ya hace.
- Compra de mercancía: **Dr Inventario de mercancía / Cr Banco** (o Caja; a crédito, Cuentas por pagar). "La mercancía se compra con lo que va generando de efectivo la empresa."
- **Contrapartida Capital (aporte de socios)** solo cuando el inventario lo aportan los socios, es decir, **al constituir la empresa** (junto con local, mobiliario, equipos de cocina...). "Normalmente ocurre en el primer año." Después, toda entrada de mercancía es por compra a proveedores.

Conclusión: **toda entrada tiene contrapartida**; lo que varía es cuál.

## 3. Alcance
**Incluye:**
- La ENTRADA de inventario **sin factura asociada** exige una cuenta de contrapartida y genera Dr Inventario / Cr contrapartida.
- Validación de la contrapartida: la cuenta debe existir y pertenecer a la empresa (guard de cuentas ajenas, `src/lib/account-guard.ts`).
- Mensaje claro cuando falta, con las opciones (Banco o Caja, Cuentas por pagar, o Capital si es aporte de socios).
- Campo de contrapartida obligatorio en el formulario de movimiento de inventario cuando es ENTRADA sin factura.
- Quitar el uso de `expectBalanced: false` en `InventoryAccountingService` y su comentario `ADR-058 B1`.

**No incluye (explícito):**
- Las entradas vinculadas a una factura de compra: siguen reutilizando el asiento de la factura (`InvoiceGLPostingService`); no se duplica el débito a Inventario.
- Crear o sugerir cuentas por defecto en el plan de cuentas de cada empresa.
- Migrar datos: producción no tiene ningún asiento de una línea (auditoría 2026-10-03: 117 asientos, todos Σ = 0).
- El trigger de la base de datos (SPEC-001), que depende de esta spec.

## 4. Reglas de negocio
- RN-1: Una ENTRADA de inventario sin factura sin `counterpartAccountId` se rechaza con un mensaje de negocio; no se crea el movimiento contabilizado ni el asiento.
- RN-2: Con contrapartida, el asiento es exactamente Dr Inventario (costo total a 2 decimales) / Cr contrapartida, con Σ = 0.
- RN-3: La cuenta de contrapartida pertenece a la empresa del movimiento; una cuenta ajena se rechaza (ADR-004).
- RN-4: Las entradas vinculadas a una factura no cambian de comportamiento.
- RN-5: Ningún camino de código crea ya un asiento de inventario con una sola línea.

## 5. Asientos contables
| Caso | Cuenta | Débito | Crédito |
|---|---|---|---|
| Compra de contado | Inventario de mercancía | costo total | |
| | Banco o Caja | | costo total |
| Compra a crédito | Inventario de mercancía | costo total | |
| | Cuentas por pagar | | costo total |
| Aporte de socios (constitución) | Inventario de mercancía | costo total | |
| | Capital / Aporte de socios | | costo total |

Invariante: débitos = créditos, con `Decimal.js` y a 2 decimales (ADR-058).

## 6. Modelo de datos
Sin cambios de esquema. `counterpartAccountId` ya existe en el movimiento y hoy es opcional; pasa a ser obligatorio por regla de servicio.

## 7. Contrato de servicio y actions
- `InventoryAccountingService.postMovement`: ENTRADA sin factura exige `counterpartAccountId`; elimina la rama de una línea.
- La action que contabiliza el movimiento (con `requireCompanyAction`, ADR-041) devuelve el mensaje de negocio.
- AuditLog, período CLOSED (R-3) y roles: sin cambios.

## 8. UI
- Formulario de movimiento de inventario: selector de cuenta de contrapartida obligatorio en ENTRADA sin factura, con etiquetas y ayuda según la contadora (Banco/Caja para compras; Capital solo para aporte de socios).
- Estados: vacío, error de validación con el mensaje exacto, éxito.
- Accesibilidad: etiqueta asociada al selector (`htmlFor`/`id`), `aria-busy` + `disabled={isPending}` en el botón.

## 9. Criterios de aceptación
- [ ] CA-1: ENTRADA sin factura y sin contrapartida → error de negocio; no se persiste ningún asiento.
- [ ] CA-2: ENTRADA con contrapartida Banco → asiento de 2 líneas, Σ = 0.
- [ ] CA-3: ENTRADA con contrapartida Capital (aporte) → asiento de 2 líneas, Σ = 0.
- [ ] CA-4: contrapartida de otra empresa → rechazada.
- [ ] CA-5: ENTRADA vinculada a factura → sin cambios (no duplica el débito a Inventario).
- [ ] CA-6: el test de arquitectura confirma que no queda ningún `expectBalanced: false` de inventario.
- [ ] CA-tenant: un usuario de otra empresa no puede contabilizar el movimiento.
- [ ] CA-período: con período CLOSED la mutación devuelve error de negocio.

## 10. Plan de agentes
Lo completa `/implementar`.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **PA-1 (RESUELTA en lo esencial, 2026-10-04, contadora):** la contrapartida puede ser **Pasivo** (cuentas por pagar al proveedor si es a crédito, o cuenta por pagar al socio si el aporte se acredita así), **Patrimonio** (capital, aporte de socios) o **Activo de efectivo** (Banco o Caja, si se paga al contado). Dijo también que "se tienen que admitir contrapartidas de costo, de gasto" y que **no** se admiten de **ingreso**. Regla a implementar: se aceptan cuentas de Activo (excepto la propia cuenta de inventario), Pasivo, Patrimonio y Costo/Gasto; se rechazan las de Ingreso. **Frase por confirmar:** la transcripción dice "no contrapartidas de activo", pero sus propios ejemplos usan Banco/Caja (Activo) como contrapartida; se interpreta como un lapsus de dictado.
- **PA-2 (usuario):** ¿hay entradas "standalone" que hoy se creen a propósito sin contrapartida (importaciones, flujos de nómina o de fabricación) que se rompan? Hay que barrer los llamadores de `postMovement` antes de implementar.
- **R-1:** el formulario de movimiento hoy puede no pedir la contrapartida; hay que revisarlo y es un cambio de UI (ui-agent).
- **R-2:** es prerrequisito de SPEC-001 (el trigger rechazaría el asiento de una línea).

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
