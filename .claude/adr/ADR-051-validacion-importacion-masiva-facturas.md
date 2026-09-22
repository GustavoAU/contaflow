# ADR-051 — La importación masiva de facturas (CSV) valida igual que la creación interactiva

**Estado:** Aceptado (decisión del dueño, 2026-09-22)
**Fecha:** 2026-09-22
**Relacionados:** Z-1 (correlativos), Z-2 (cálculo de impuestos), R-6 (AuditLog), ADR-006 D-2/D-3/D-5, ADR-049 (integridad del IVA — dejaba este hueco anotado en "Fuera de alcance")

## Contexto

`importInvoiceBatchAction` (`src/modules/invoices/actions/invoice-batch.actions.ts`) llamaba a `InvoiceService.create` **directo**, fila por fila, sin pasar por `getInvoiceSchemas(...).create.safeParse(...)` como sí hace `createInvoiceAction`. Consecuencia comprobada: el RIF no se validaba (formato ni dígito verificador), el Nº de Control no era obligatorio en compras, la fecha no tenía rango (`new Date("12026-01-01")` no es `Invalid Date` en V8 — la misma clase de bug del "typo de año" que ya se había corregido en otros 10 schemas), los montos no tenían tope (`MAX_INVOICE_AMOUNT`), y una retención IVA > 0 se aceptaba sin comprobante (violando Prov. 0049 Art. 11). Además, las facturas de **venta** importadas por este camino nunca recibían Nº de Control — `InvoiceService.create` no lo autogenera; solo `createInvoiceAction` lo hace, llamando a `getNextControlNumber` bajo `Serializable` antes de crear (Z-1, Prov. 0071 Art. 14).

## Decisión

Cada fila del CSV se arma como el mismo payload que espera `create` y se valida con `getInvoiceSchemas(getFiscalConfig(ctx.country)).create.safeParse(...)` antes de crear nada. Si falla, la fila se reporta en `errors` (no bloquea el resto del batch). Además:

- **Correlativo de venta (Z-1).** Si el CSV no trae `nro_control` en una fila de venta, se genera con `getNextControlNumber(tx, companyId, "SALE")` dentro de `withSerializableRetry` — mismo criterio que `createInvoiceAction`. Compras siguen con `prisma.$transaction` normal (ReadCommitted), exigiendo el Nº de Control del proveedor.
- **Notas de Crédito/Débito bloqueadas en el batch.** `InvoiceService.create` no valida ni vincula `relatedInvoiceId` — esa lógica (factura original existe y es del tenant, no está anulada, período no cerrado, monto no excede el saldo pendiente) vive **exclusivamente** en `InvoiceCreditDebitNoteService`. El libro (`InvoiceService.getBook`, `signOf(docType)`) sí resta/suma una NC/ND de los totales declarados, así que una NC "flotante" sin ese respaldo reduciría ventas declaradas sin trazabilidad ni tope. El CSV tampoco tiene columna para `relatedDocNumber`. Por eso una fila con `tipo_doc` NOTA_CREDITO/NOTA_DEBITO se rechaza explícitamente, con un mensaje que dirige al formulario correcto.
- **Tope de 200 filas.** El diálogo (`InvoiceBatchImportDialog.tsx`) ya anunciaba "Máximo 200 filas por archivo", pero nada lo exigía en el servidor — la action es invocable directo. Se agregó el mismo guard que usa `importAccountsAction` (`src/modules/import/actions/import.actions.ts`, precedente de 1000 filas para otro dominio).
- **Corte por suscripción vencida.** `assertWriteAllowed(companyId)` antes del loop — mismo guard que `createInvoiceAction`, que esta action no tenía.
- **Errores Prisma nunca crudos.** El `catch` por fila distingue P2002 de correlativo (transitorio) de P2002 genérico (duplicado) y P2003, y el resto de errores pasa por `mapPrismaError` (P2034, timeouts de conexión, errores técnicos de BD por palabra clave) en vez de `e.message` desnudo — antes cualquier error no-P2002/P2003 llegaba crudo a la tabla de resultados del importador.

Los 6 puntos anteriores están cubiertos por tests con RED→GREEN y verificados por **mutación** (revertir cada uno por separado hace fallar tests específicos).

## Fuera de alcance (documentado, decisión pendiente del dueño)

- **Retenciones históricas sin comprobante digitalizado.** El CSV no tiene columna para el Nº de comprobante de retención IVA, así que cualquier fila con `ret_iva > 0` se rechaza (H-14 lo exige). Es fiscalmente correcto, pero bloquea sin alternativa la migración de historial que YA tenía una retención aplicada en otro sistema (un caso de uso real y común de "importar CSV"). Workaround hoy: cargar esas filas puntuales por el formulario interactivo. Si se decide soportarlo, agregar una columna opcional `ret_iva_comprobante` al CSV.
- **Orden de correlativos de venta vs. fecha del CSV.** El loop es secuencial y sin huecos (cada fila es su propia transacción atómica; un fallo revierte todo, incluida la secuencia), pero el correlativo se asigna en el orden de las FILAS del CSV, no de `fecha` — si el CSV no viene ordenado cronológicamente, un Nº de Control más alto puede terminar con fecha anterior a uno más bajo, un patrón que una fiscalización podría cuestionar (Prov. 0071 Art. 14 espera orden correlativo = orden de emisión). Además, dejar `nro_control` vacío en una migración histórica **genera un número nuevo que no es el original** que la factura física ya tenía — el CSV no distingue "venta nueva sin impresora fiscal" de "migración con número real". Si se decide atacar esto: ordenar `rows` por `fecha` antes del loop para las filas sin `nro_control`, y advertir explícitamente en el diálogo que dejarlo vacío inventa un número.
- **`taxCategory` hardcodeado a `"GRAVADA"`.** Una fila con solo `exento > 0` se clasifica bien en los totales del libro (que iteran `taxLines`, no `taxCategory`), pero la columna "Categoría" de esa factura queda mostrando GRAVADA. Cosmético, preexistente, no lo agrava este fix.
- **Sin tope de decimales en montos.** `withinAmountRange` (usado por `base`/`amount`/retenciones/IGTF en todo el módulo, no solo aquí) acota el rango pero no la cantidad de decimales — un monto con miles de decimales pasa. Preexistente, compartido con el resto del módulo de facturas; candidato a un fix aparte junto con el hallazgo ya anotado en ADR-049 sobre montos negativos en retenciones/IGTF.

## Consecuencias

- Un CSV con datos previamente aceptados sin validar (RIF malformado, compra sin Nº de Control, fecha fuera de rango, retención sin comprobante, Nº de Control de venta ausente) ahora rechaza esas filas puntuales con un mensaje claro, en vez de crear una factura en un estado fiscalmente inválido.
- Un CSV con Notas de Crédito/Débito se rechaza por completo para esas filas — es un cambio de comportamiento deliberado hasta que exista threading real a la factura original en el formato CSV.
- Un CSV de más de 200 filas se rechaza completo, con el mismo límite que ya anunciaba la UI.
