---
id: SPEC-007
titulo: Toda entrada de inventario lleva contrapartida (nunca un asiento de una sola línea)
estado: HECHA   # cerrada 2026-10-04; rama lista, pendiente de merge (requiere confirmación del usuario)
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
- [x] CA-1: ENTRADA sin factura y sin contrapartida → error de negocio; no se persiste ningún asiento. **Tests CA-1 de `postMovement` (contrapartida nula, indefinida y con ítem LOT) y de `createDraftMovement`.**
- [x] CA-2: ENTRADA con contrapartida Banco → asiento de 2 líneas, Σ = 0. **Test CA-2 (Banco): 2 líneas Dr Inventario / Cr Banco, Σ = 0.**
- [x] CA-3: ENTRADA con contrapartida Capital (aporte) → asiento de 2 líneas, Σ = 0. **Test CA-3 (Capital, EQUITY): 2 líneas, Σ = 0.**
- [x] CA-4: contrapartida de otra empresa → rechazada. **Tests CA-4 y RN-3 (guard de cuentas ajenas, consulta acotada por `companyId`, cuenta dada de baja).**
- [x] CA-5: ENTRADA vinculada a factura con asiento → se enlaza al asiento de la factura y no crea otro (no duplica el débito a Inventario). **Tests RN-4 (con factura no crea asiento, enlaza el de la factura; LOT y SERIAL) y H-1 (compra, línea vigente, asiento de la empresa y POSTED).**
- [x] CA-5b: ENTRADA vinculada a factura sin asiento → rechazada con mensaje de negocio; el movimiento sigue en DRAFT. **Tests CA-5b (factura inexistente, ajena o sin asiento) y H-1 (asiento anulado).**
- [x] CA-6: el test de arquitectura confirma que no queda ningún `expectBalanced: false` de inventario. **`src/__tests__/architecture/inventory-no-single-line-entries.test.ts` (3 tests).**
- [x] CA-tenant: un usuario de otra empresa no puede contabilizar el movimiento. **Todas las lecturas (movimiento, factura, línea, asiento, cuenta, período, líneas del asiento original) van acotadas por `companyId`; las tablas falsas de `fake-db.ts` filtran por TODO el `where` y hay tests ADR-004 por consulta.**
- [x] CA-período: con el período de la fecha del movimiento CLOSED, tanto `createDraftMovement` como `postMovement` devuelven error de negocio y no crean asiento (PA-7). **Tests PA-7 (ENTRADA, ENTRADA con factura, SALIDA, AJUSTE, fecha en UTC) y los de `createDraftMovement`.**
- [x] CA-7: anular una ENTRADA con contrapartida → contra-asiento de 2 líneas (Dr contrapartida / Cr Inventario), Σ = 0. **Tests RN-6 (espejo exacto a 4 decimales; M-2: usa las cuentas del asiento original aunque el ítem se reconfigure; L-A: conserva el tercero).**
- [x] CA-8: anular una ENTRADA ligada a factura → rechazada con mensaje de negocio; el movimiento sigue POSTED y el stock no cambia. **Tests CA-8 (3 variantes) y de la regla antes de leer nada.**
- [x] CA-9: anular una ENTRADA sin asiento original (`transactionId` nulo) → revierte el stock y no crea asiento. **Tests CA-9 (con y sin contrapartida; SALIDA y AJUSTE sin `transactionId`).**

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
- **PA-7 (hallazgo al implementar, 2026-10-04; se corrige aquí por R-3):** el chequeo de período CLOSED existe solo en `createDraftMovement` (R-09). `postMovement` crea el asiento con la fecha del movimiento sin volver a mirar el período: un borrador creado con el período abierto se puede contabilizar después de cerrarlo. Se añade en `postMovement` el mismo chequeo (período de `movement.date`, getters UTC) para ENTRADA, SALIDA y AJUSTE. La anulación crea su contra-asiento con la fecha de hoy y no cambia.
- **PA-8 (hallazgo del test-agent, verificado con una sonda; NO se implementa en esta spec, necesita decisión):** un movimiento cuyo `totalCost` redondea a 0,00 (por ejemplo, cantidad 0,0001 × costo 10 = 0,001) deja una `Transaction` SIN líneas: `quantizeGLEntries` descarta las líneas en 0,00 y devuelve 0 líneas, y `assertBalancedGLEntries([])` pasa. Ya ocurre hoy en cualquier tipo de movimiento. Opciones: rechazar un costo total 0,00 con mensaje de negocio, o permitirlo (muestras sin costo, donaciones) y no crear la `Transaction`. Es decisión de negocio; spec aparte.
- **PA-9 (revisión de seguridad 2026-10-04, security-agent; verificada leyendo el código): H-1 HIGH bloqueante, se corrige en esta spec.** La rama con factura de `postMovement` solo comprobaba que la factura existiera y tuviera `transactionId`: no exigía que fuera de COMPRA, que el movimiento fuera una línea de esa factura, ni que el asiento fuera de la empresa y estuviera vigente; y `createMovementAction` aceptaba `invoiceId` del cliente (el formulario nunca lo envía; los movimientos ligados a factura los crea solo `InvoiceLineService`). Un OPERATIONS podía crear una ENTRADA sin contrapartida con `invoiceId` de una factura de venta, y un contador la contabilizaba sin asiento de inventario. Corrección: validar los cuatro puntos al contabilizar y descartar `invoiceId` del cliente en la action. También en esta spec: M-2 (la anulación deriva de las LÍNEAS GUARDADAS del asiento original, no de la cuenta que hoy tenga el ítem), L-1 (la auditoría guarda `counterpartAccountId`, `invoiceId` y `date`) y un mensaje de negocio para el choque del único de `InventoryMovement.transactionId` (M-1, paliativo).
- **PA-10 (hallazgo mío al revisar el aviso del ledger-agent sobre ADR-054; verificado en producción 2026-10-05): una compra a crédito sin factura contra Cuentas por pagar NO se puede contabilizar.** `prisma-tercero-required-gate` exige tercero (cliente, proveedor, socio o empleado) en cada línea de una cuenta con `requiresThirdParty`. En el plan de producción, "Cuentas por Pagar a Proveedores", "Cuentas por Pagar Accionistas" y "Otras Cuentas por Pagar" lo exigen; Bancos, Cajas y todo Patrimonio (34 cuentas, incluido Capital Social) no. El movimiento de inventario no registra tercero, así que el borrador se aceptaba y el gate lo rechazaba al contabilizar, sin salida para el contador. **Solución de esta spec (sin cambio de esquema):** `assertEntradaCounterpart` rechaza en el borrador y al contabilizar toda contrapartida que exija tercero, con el mensaje "…Para una compra a crédito, regístrela con su factura de compra; para una entrada sin factura elija Banco, Caja o Capital."; el formulario no ofrece esas cuentas en una ENTRADA y la ayuda ya no menciona Cuentas por pagar. Es coherente con lo que dijo la contadora ("por lo general la entrada es por la factura", y la factura lleva al proveedor), pero **se aparta de su frase "Cuentas por pagar si tiene crédito"** para el caso sin factura: si ella quiere esa vía, hace falta una spec aparte que añada tercero al movimiento (columnas en `InventoryMovement` + selector de proveedor o socio + migración).
- **Seguimiento FUERA de esta spec (cada uno necesita su propia spec; ninguno bloquea el merge de la SPEC-007):**
  - **Facturas de compra con 2 o más líneas de inventario (M-1 / PA-5): CONFIRMADO en parte.** `InventoryMovement.transactionId` es único y el índice `InventoryMovement_transactionId_key` existe en producción (consulta del 2026-10-04). `InvoiceLineService` crea un movimiento por línea y `InvoiceService` enlaza todos al mismo asiento de la factura, así que el segundo enlace violaría el único. No lo ejecuté contra Postgres real: está confirmado por el esquema, el índice vivo y la lectura del código. Corrección de fondo: quitar el único 1:1 (la migración debe usar `DROP INDEX`, nunca `DROP CONSTRAINT`) y pasar la relación a 1:N.
  - **Asientos sin período (C-1 / M-3): CONFIRMADO en producción.** 23 de 117 asientos tienen `periodId` nulo, incluido el único de inventario. `PeriodSnapshotService` y `FiscalYearCloseService` agregan por `periodId`, así que los excluyen. Además, la guarda de período de inventario es más débil que `PeriodService.resolveFiscalPeriodId` (no rechaza un mes sin período) y la fecha del movimiento no usa `zBusinessDateString`.
  - **Campos del cliente que deciden la contabilidad de una factura:** `CreateInvoiceSchema` acepta `transactionId` y `periodId` del cliente y `InvoiceService.create` guarda `transactionId` y se salta el asiento de la factura (verificado leyendo `invoice.schema.ts:244` e `InvoiceService.ts:369,407-410`). Es la raíz de H-1; esta spec lo contiene del lado de inventario, pero hay que cerrarlo en el módulo de facturas y barrer los demás schemas que acepten `*transactionId` del cliente.
  - **Cantidad con más de 4 decimales (M-4):** `quantity` acepta más de 4 decimales y el costo total se calcula con la cantidad sin redondear, mientras la columna guarda 4: un movimiento puede asentar un monto sin mover stock.
  - La anulación fecha el contra-asiento con `new Date()` (UTC) sin mirar el período de hoy (L-3); costo total 0,00 (PA-8).
  - **Re-revisión de seguridad (2026-10-04): GO, 0 CRITICAL / 0 HIGH / 0 MEDIUM.** H-1, M-1, M-2, L-1 y PA-10 cerrados; `autoPostMovementInTx` idéntica a la de antes de la rama. L-A (la anulación conservaba terceros) se corrigió en esta rama. Quedan como seguimiento: **L-B** (la anulación no mira si el asiento original ya fue anulado a mano desde el módulo de asientos y crearía un segundo reverso), **L-C** (defensa en profundidad: exigir `transaction.reference === invoiceId`; antes hay que comprobar que los asientos de factura de producción tengan `reference`; queda cubierto al cerrar la raíz en `CreateInvoiceSchema`), e INFO: el mensaje `MSG_FACTURA_NO_ES_COMPRA` dice "elimine este borrador" pero solo OPERATIONS puede eliminarlo (un contador no), una factura dada de baja sale como "aún no tiene asiento", y la anulación sin líneas visibles no deja constancia explícita en el AuditLog.
- **R-1:** el formulario de movimiento hoy puede no pedir la contrapartida; hay que revisarlo y es un cambio de UI (ui-agent).
- **R-2:** es prerrequisito de SPEC-001 (el trigger rechazaría el asiento de una línea).

## 12. Cierre
- **Rama:** `feat/spec-007-entrada-inventario-contrapartida`, con `origin/main` fusionado (sin conflictos). Sin merge a `main`: requiere confirmación del usuario.
- **Commits de código:** `4417cc77` tests en RED, `40874757` servicios, `7174978b` interfaz, `a20838b2` comentarios, `c16c9fbe` tests de la ronda de seguridad en RED, `8e59ce01` correcciones H-1 / M-1 / M-2 / L-1, `5e931703` guarda de tercero (PA-10), `07dcbb6d` terceros en la anulación (L-A). El resto de commits son de esta spec.
- **Tests:** antes 5641 → después 5797 antes de fusionar con `main` (+156); con `main` fusionado la suite completa da 6062, 0 fallos. `tsc` 0 errores, `format:check` limpio, lint 0 errores.
- **Seguridad:** primera revisión GO con condiciones (H-1 HIGH bloqueante, corregido); re-revisión GO sin hallazgos CRITICAL, HIGH ni MEDIUM abiertos.
- **Producción:** sin migraciones ni cambios de datos. Las 8 ENTRADA contabilizadas sin asiento (`transactionId` nulo) siguen como estaban.
- **Pendiente de la contadora:** PA-4 (ajustes de inventario) y PA-6 (rechazar anular una entrada ligada a factura). PA-10 se aparta de su frase "Cuentas por pagar si tiene crédito" para el caso sin factura; ver PA-10.
- **ADR creado o actualizado:** ninguno nuevo (aplican ADR-058 y ADR-054).
- **Lección aprendida:** LL-018.
