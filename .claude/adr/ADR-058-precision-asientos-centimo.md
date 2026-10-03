# ADR-058 — Los asientos se cuantizan al céntimo antes de verificar y persistir

- **Estado:** Aceptado (2026-10-03)
- **Contexto:** SPEC-004 (precisión de asientos) y SPEC-001 (trigger de cuadre en BD)
- **Relacionados:** ADR-005 (anular, nunca borrar), ADR-057 (historial de migraciones repetible)

## Contexto
Un asiento de nómina en USD (`NOM-2026-08-16-83jgfm`, empresa demo) quedó guardado con Σ = −0,0001 Bs. aunque `assertBalancedGLEntries` dijo que cuadraba:
1. Los servicios calculan en precisión alta de `Decimal.js` (~20 dígitos) y multiplican por la tasa BCV (aquí 779,9522, 11 líneas).
2. La verificación suma esos valores **sin redondear** y pasa.
3. Postgres guarda cada línea en `JournalEntry.amount Decimal(19,4)` y **redondea cada línea por separado**.

Es una clase de bug: 38 call-sites de `assertBalancedGLEntries` en ~20 servicios. Además, la aplicación tolera hoy un descuadre de ±0,01 (tolerancia por defecto) y la contadora exige cuadre exacto.

Regla contable de la contadora (2026-10-03): "decimales se utilizan solo dos; si son cuatro, se redondean a dos"; los libros deben cuadrar en cero; las diferencias reales se investigan y se registran de forma explícita (diferencial, descuento al cajero, ajustar el pago a lo que salió).

## Decisión
1. **Unidad contable = céntimo (2 decimales).** Todo `JournalEntry.amount` nuevo es múltiplo de 0,01. La columna sigue siendo `Decimal(19,4)`; los asientos históricos a 4 decimales no se reescriben.
2. **Una función central** `quantizeGLEntries(entries, opts)` en `src/lib/gl-assertions.ts`. Es la única que redondea; ningún servicio redondea líneas de asiento por su cuenta.
3. **Redondeo:** `ROUND_HALF_UP` de `Decimal.js`, que es "mitad alejándose de cero". Es simétrico entre débito (+) y crédito (−): +0,005 → +0,01 y −0,005 → −0,01. No es "mitad hacia arriba" literal; se elige a propósito para conservar la antisimetría.
4. **Absorción del residuo (opción A, decidida por el usuario):** el residuo de redondear N líneas se suma a la línea de **mayor valor absoluto** (empate: la primera), **excluyendo** las marcadas `noAbsorb`. Se marcan `noAbsorb` las líneas de obligaciones fiscales (IVA, retenciones por enterar, IGTF, IVSS/FAOV/INCES/RPE/pensiones) y las líneas con tercero (CxC/CxP), para que el mayor no diverja de la declaración o del auxiliar. Si no hay candidata, se lanza error.
5. **Tope del residuo:** si `|residuo| > N × 0,005` no es redondeo sino un error de cálculo: se lanza, no se absorbe. Si `|Σ bruta| > N × 0,005` antes de redondear, el conjunto no es un asiento balanceado y tampoco se absorbe (ver modos).
6. **Modos:**
   - `absorb` (por defecto): redondea, descarta líneas que quedan en 0,00 y absorbe el residuo.
   - `exact`: **no redondea ni absorbe**; devuelve las entradas tal cual. Obligatorio en asientos **derivados de lo ya guardado**: anulaciones (VOID), cierre de ejercicio y liquidación de caja. Negar un asiento histórico a 4 decimales debe ser el espejo exacto (ADR-005); cuantizarlo dejaría centésimas en las cuentas.
   - `expectBalanced: false`: redondea pero no absorbe ni exige Σ = 0. Solo para flujos que crean asientos incompletos a propósito (hoy, la ENTRADA de inventario sin contrapartida, `InventoryAccountingService`); es una excepción documentada y un hallazgo aparte (SPEC-001).
7. **Redondear en el origen, no solo en el asiento.** Cada servicio redondea a 2 decimales el monto del DOCUMENTO (depreciación, prestaciones, liquidación, utilidades, vacaciones, costo de inventario, IGTF de lotes, ajuste INPC) donde lo calcula, y arma el asiento con ese valor. Así el auxiliar coincide con el mayor y el residuo solo cubre multiplicaciones por tasa (nómina USD, diferencial cambiario). Cuantizar solo la línea del asiento desalinearía los auxiliares.
8. **Trazabilidad (R-6):** la función devuelve `{ entries, residual, absorbedIndex }`. Cuando `residual ≠ 0`, el servicio lo escribe en el payload del `AuditLog` del asiento (`glRounding: { residual, absorbedIndex, scale: 2 }`).
9. **Orden de despliegue:** `assertBalancedGLEntries` mantiene su tolerancia de 0,01 hasta que TODOS los call-sites cuantizan; solo entonces pasa a 0. Un test de arquitectura exige que todo archivo no-test que llame `assertBalancedGLEntries` llame también `quantizeGLEntries`.
10. **Asiento manual (TransactionService):** se rechazan montos con más de 2 decimales (Zod `decimalPlaces ≤ 2`) en vez de redondear en silencio lo que el usuario escribió.

## Consecuencias
- **Visible:** en una nómina USD de 11 líneas el residuo puede llegar a unos pocos céntimos y se ve en reportes. Aceptado por el usuario (opción A), trazable en el AuditLog.
- **Cambio de comportamiento deliberado:** los montos que hoy se guardan a 4 decimales pasan a 2 en los asientos y documentos nuevos. Afecta tests existentes (estimado 5 a 15, nómina y depreciación).
- **Fuera de alcance:** `InvoiceGLPostingService` (no verifica el cuadre; su total depende de `Invoice.totalAmountVes`, que se guarda sin redondear en facturas con líneas) → SPEC-005; flujo de faltante de caja → spec propia.
- **Sin cambios de esquema** ni de datos históricos.

## Alternativas descartadas
- **Cuenta propia "Diferencias de redondeo":** transparente, pero obliga a configurarla en cada empresa y un servicio sin ella fallaría. El usuario eligió absorber en la línea mayor.
- **Mantener la tolerancia de 0,01:** la contadora pidió cuadre exacto; además esconde el defecto (0,0001) en lugar de corregirlo.
- **Redondear solo dentro de `assertBalancedGLEntries`:** la verificación pasaría, pero lo persistido seguiría redondeándose línea a línea en Postgres.
