---
id: SPEC-007
titulo: Toda entrada de inventario lleva contrapartida (nunca un asiento de una sola línea)
estado: EN_CURSO   # plan escrito 2026-10-04; pendiente de confirmación del usuario (PA-3 y PA-4)
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
- RN-4: Una entrada vinculada a una factura nunca crea un asiento propio: se enlaza al asiento de la factura. Si la factura aún no tiene asiento, la entrada se rechaza con un mensaje de negocio (PA-3, contadora 2026-10-04).
- RN-5: Ningún camino de código crea ya un asiento de inventario con una sola línea.
- RN-6: La anulación de una ENTRADA (`voidPostedMovement`, que hoy crea un contra-asiento de UNA línea, hallazgo al implementar, PA-6) deriva de lo guardado: con contrapartida, contra-asiento exacto Dr contrapartida / Cr Inventario (Σ = 0); ligada a factura, se rechaza (se anula la factura o se emite nota de crédito); sin asiento original (`transactionId` nulo, datos previos), solo revierte el stock y no crea asiento.

## 5. Asientos contables
| Caso | Cuenta | Débito | Crédito |
|---|---|---|---|
| 1 | test-agent | RED en `InventoryAccountingService.test.ts`: CA-1 (sin contrapartida → error y no se crea asiento), CA-2 (Banco, 2 líneas Σ=0), CA-3 (Capital/EQUITY), CA-4 (cuenta de otra empresa), tipos rechazados (Ingreso, Contra-activo, la cuenta de inventario del propio ítem), CA-5 y PA-3 (con factura: sin asiento nuevo y enlaza al de la factura; factura sin asiento → error), CA-tenant, CA-período. Test en `createDraftMovement`: falla temprano sin contrapartida. | Sí, RED por la razón correcta |
| 2 | test-agent | CA-6: test de arquitectura que falla si `InventoryAccountingService.ts` contiene `expectBalanced: false`. | Sí, RED |
| 3 | ledger-agent | GREEN en `InventoryAccountingService.postMovement` y `InventoryOperationsService.createDraftMovement`: contrapartida obligatoria en ENTRADA sin factura; helper de validación (misma empresa con `assertAccountsBelongToCompany`, tipo ASSET/LIABILITY/EQUITY/EXPENSE, distinta de la cuenta de inventario del ítem); rama con factura según PA-3; se elimina la rama de una línea, `expectBalanced:false` y el comentario `ADR-058 B1`; `voidPostedMovement` de ENTRADA según RN-6 (PA-6); `assertBalancedGLEntries` siempre. | GREEN |
| 4 | ui-agent | `MovementForm`: selector obligatorio solo en ENTRADA sin factura, con ayuda de la contadora (Banco/Caja o CxP para compras; Capital solo si es aporte de socios), `label`/`id`, `aria-busy` y `disabled={isPending}`. `inventory/page.tsx`: añadir `EQUITY` a los tipos ofrecidos (hoy solo ASSET/EXPENSE/LIABILITY, por lo que Capital no se podía elegir). | Test jsdom del formulario |
| 5 | security-agent | Revisión de `postMovementAction` y `createDraftMovement`: aislamiento de empresa, cuenta ajena, mensajes que no filtran errores crudos, rol ACCOUNTING. CRITICAL/HIGH bloquean. | n/a |
| 6 | (yo) | Gates: `tsc`, `vitest`, `lint`, `format:check`; marcar CA-1..CA-período; cerrar §12; actualizar Estado Activo de `contaflow-context-v3.md`. Sin merge. | n/a |
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
- [ ] CA-5: ENTRADA vinculada a factura con asiento → se enlaza al asiento de la factura y no crea otro (no duplica el débito a Inventario).
- [ ] CA-5b: ENTRADA vinculada a factura sin asiento → rechazada con mensaje de negocio; el movimiento sigue en DRAFT.
- [ ] CA-6: el test de arquitectura confirma que no queda ningún `expectBalanced: false` de inventario.
- [ ] CA-tenant: un usuario de otra empresa no puede contabilizar el movimiento.
- [ ] CA-período: con período CLOSED la mutación devuelve error de negocio.
- [ ] CA-7: anular una ENTRADA con contrapartida → contra-asiento de 2 líneas (Dr contrapartida / Cr Inventario), Σ = 0.
- [ ] CA-8: anular una ENTRADA ligada a factura → rechazada con mensaje de negocio; el movimiento sigue POSTED y el stock no cambia.
- [ ] CA-9: anular una ENTRADA sin asiento original (`transactionId` nulo) → revierte el stock y no crea asiento.

## 10. Plan de agentes
Lo completa `/implementar`.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **PA-1 (RESUELTA 2026-10-04, contadora + confirmación del usuario):** la contrapartida puede ser **Pasivo** (cuentas por pagar al proveedor, o al socio), **Patrimonio** (capital, aporte de socios), **Activo** (Banco o Caja si es al contado; la frase "no activo" de la transcripción fue un lapsus de dictado, el usuario confirmó que el Activo también se admite) o **Costo/Gasto**. Se **rechazan** las de **Ingreso** y la propia cuenta de inventario. Regla a implementar: tipos permitidos = Activo (excepto la cuenta de inventario del ítem), Pasivo, Patrimonio y Gasto/Costo.
- **PA-2 (RESUELTA 2026-10-04, barrido de llamadores):** `postMovement` tiene UN solo llamador: `postMovementAction` (`inventory-accounting.actions.ts`), usado por el formulario de movimientos y por `PendingMovementsList`. Las facturas y los pedidos NO lo usan: llaman a `autoPostMovementInTx`, que para ENTRADA reutiliza el asiento de la factura y no crea líneas. No hay importación, nómina ni fabricación que cree entradas sin contrapartida. Datos de producción (solo lectura): 1 ENTRADA en DRAFT (con contrapartida), 8 ENTRADA POSTED sin factura, sin contrapartida y **sin asiento** (`transactionId` nulo), 1 SALIDA POSTED con factura y asiento. Ningún asiento de una línea.
- **PA-3 (RESUELTA 2026-10-04, contadora: "no registrar hasta tener el asiento"):** la entrada ligada a factura NO se registra mientras la factura no tenga asiento; cuando lo tiene, se enlaza a ese asiento sin crear otro. Además pidió que el proveedor tenga una condición de pago (contado o crédito) y, "y/o monto de factura o indexado" (frase ambigua, por aclarar): eso es una función nueva sobre `InvoiceGLPostingService` y va en una spec aparte, no en esta. Análisis original: `postMovement` no mira `invoiceId`. Una ENTRADA ligada a factura que llega a `postMovement` (ítems LOT/SERIAL, que `autoPostMovementInTx` deja en DRAFT, o una factura sin asiento) hoy crea un asiento de UNA línea Dr Inventario. Si la factura ya tenía su asiento (Dr Inventario), el Libro Mayor queda con el débito **duplicado**. RN-4 ("sin cambios") y RN-5 ("ninguna línea suelta") chocan en ese camino. Propuesta: con `invoiceId`, `postMovement` NO crea asiento y enlaza el movimiento al asiento de la factura, igual que `autoPostMovementInTx`; si la factura aún no tiene asiento, rechaza con mensaje de negocio. Corrige la duplicación y respeta la intención de la spec ("no se duplica el débito").
- **PA-4 (RESPUESTA PROVISIONAL 2026-10-04; la contadora no está segura y la confirmará el 2026-10-05; fuera de alcance de esta spec, irá en una spec aparte):** por ahora dijo que el ajuste por pérdida o vencimiento va a Costo de ventas, que es lo que hace hoy el servicio. Antes había dicho que en negocios con mercancía perecedera debe haber una cuenta de gasto aparte para mermas. Sin responder: sobrantes y soporte. Análisis original: el formulario exige contrapartida también en AJUSTE, pero el servicio la ignora (siempre Dr COGS / Cr Inventario) y la guarda sin usarla. El usuario elige "Mermas" y el asiento usa la cuenta de costo del ítem. No toca el cuadre; propongo corregirlo en una spec aparte.
- **PA-5 (hallazgo fuera de alcance, SIN VERIFICAR):** `InventoryMovement.transactionId` es `@unique`. Una factura de compra con 2 o más líneas de inventario haría que `autoPostMovementInTx` enlace dos movimientos al MISMO asiento de factura, lo que violaría el único. Los tests mockean Prisma y no lo ven. Hay que comprobarlo con una prueba de integración en Postgres real antes de afirmar nada.
- **PA-6 (hallazgo al implementar, 2026-10-04; DECISIÓN CONSERVADORA tomada, necesita confirmación):** `voidPostedMovement` también crea un asiento de UNA línea para una ENTRADA (Cr Inventario sin contrapartida; comentario "N4"). Contradice RN-5 y el trigger de la SPEC-001 lo rechazaría. Se corrige según RN-6. La parte discutible es **rechazar la anulación de una entrada ligada a factura**: hoy produce un contra-asiento de una línea que deja descuadrada la contabilidad; lo correcto para reversar una compra facturada es anular la factura o emitir nota de crédito (`InvoiceGLPostingService` ya genera Dr CxP / Cr Inventario / Cr IVA-CF). Producción no tiene ENTRADA ligada a factura (0 filas, consulta del 2026-10-04), así que la restricción no rompe datos. Confirmar con la contadora si hay una razón para anular solo el movimiento.
- **R-1:** el formulario de movimiento hoy puede no pedir la contrapartida; hay que revisarlo y es un cambio de UI (ui-agent).
- **R-2:** es prerrequisito de SPEC-001 (el trigger rechazaría el asiento de una línea).

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
