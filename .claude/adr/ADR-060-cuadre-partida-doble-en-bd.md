# ADR-060 — El cuadre de partida doble lo garantiza la base de datos (constraint trigger diferido)

- **Estado:** Aceptado (2026-10-05)
- **Contexto:** SPEC-001 (cuadre de partida doble garantizado en la BD)
- **Relacionados:** ADR-005 (anular, nunca borrar), ADR-057 (historial de migraciones repetible), ADR-058 (asientos al céntimo)

## Contexto
Hasta ahora "débitos = créditos" solo se validaba en la aplicación (`assertBalancedGLEntries`). Cualquier escritura que no pasara por esos servicios —un script de `prisma/`, un `$executeRaw`, una migración de datos, un módulo nuevo, un agente que se salte el servicio— podía dejar un asiento descuadrado sin que nada lo detuviera. Pasó: un asiento de nómina en USD quedó guardado con Σ = −0,0001 (ADR-058). Para la invariante más importante de una app contable, la BD debe ser la última línea de defensa.

La contadora decidió el 2026-10-03 que el cuadre es **exacto** (T = 0). Eso obligó a que primero todos los generadores cuantizaran al céntimo (ADR-058, SPEC-004) y a que no quedara ningún asiento incompleto a propósito (SPEC-007).

## Decisión
1. **Un `CONSTRAINT TRIGGER` diferido** (`trg_journalentry_balance`, `AFTER INSERT OR UPDATE OF "amount","transactionId" OR DELETE ON "JournalEntry"`, `DEFERRABLE INITIALLY DEFERRED`, `FOR EACH ROW`) ejecuta `fn_check_journal_balance()` **al COMMIT**: por cada fila tocada, suma `amount` de su asiento (`transactionId`) y, si `ABS(suma) > T`, lanza `RAISE EXCEPTION` con **SQLSTATE propio `CF001`** y el marcador `CF001:` al inicio del mensaje. La transacción completa hace rollback: no queda ni la cabecera ni ninguna línea.
2. **T = 0, EXACTO**, como constante de la función (`v_tolerance`): un único sitio para cambiarla.
3. **Diferido.** Un servicio puede insertar las líneas una por una dentro del mismo `$transaction` (estado intermedio descuadrado); solo importa el estado al COMMIT.
4. **Solo los asientos tocados.** Nunca recorre la tabla completa; no valida filas ya existentes al crearse el trigger (la auditoría de producción del 2026-10-03/05 dio 0 asientos descuadrados). Si una línea cambia de asiento (`UPDATE "transactionId"`) se comprueban el de origen y el de destino.
5. **Solo vigila lo que afecta al cuadre.** `UPDATE OF "amount","transactionId"`: cambiar la descripción de una línea no dispara la validación. Una `Transaction` sin líneas no dispara nada (no hay fila de `JournalEntry` que lo active).
6. **Anular sigue sujeto al cuadre** (RN-3): el reverso debe cuadrar igual que el original. Borrar TODAS las líneas de un asiento lo deja en 0 y pasa (la limpieza de tests y un `DELETE` de un asiento completo no se bloquean; los asientos no se borran por ADR-005, esto es solo coherencia).
7. **La aplicación traduce el error.** `isUnbalancedEntryError()` (en `src/lib/prisma-errors.ts`) recorre el error buscando `code === "CF001"` o un mensaje con `CF001:` —Prisma no conoce el código y su forma depende del driver (adapter-pg: en `code`/`cause`; adaptador de Neon: anidado en `meta.driverAdapterError.cause`, LL-014)—. `mapPrismaError`/`toActionError` devuelven el mensaje de negocio *"El asiento no cuadra: débitos y créditos deben ser iguales. No se guardó ningún cambio."* y nunca el texto crudo del motor.
8. **Barrido de generadores.** Para que T = 0 no rompa flujos legítimos, TODO creador de líneas de asiento cuantiza con `quantizeGLEntries` (ADR-058). La causación de facturas (`InvoiceGLPostingService`) era el único que no lo hacía: ahora cuantiza y verifica (residuo en la línea de base, nunca en CxC/CxP, IVA, IGTF ni retención). Un test de arquitectura (`gl-entry-creators-quantize.test.ts`) impide que un generador nuevo olvide cuantizar.

## Consecuencias
- **Positivas:** ninguna vía —servicio, script, SQL a mano, módulo nuevo— puede dejar un asiento descuadrado; el balance de comprobación deja de poder derivar centésimas.
- **Costo:** el trigger es por fila: un asiento de N líneas hace N comprobaciones (cada una suma N filas por el índice de `transactionId`) al COMMIT. Con asientos de decenas o cientos de líneas es despreciable (200 líneas: 164 ms en PGlite local); un asiento de miles de líneas lo notaría. Si algún día hace falta, se cambia a una comprobación única por asiento.
- **Riesgo operativo:** un flujo que hoy guarde líneas sin cuantizar empezará a fallar con el mensaje de negocio en vez de guardar un asiento descuadrado. Es el comportamiento deseado; el test de arquitectura y la causación de facturas cuantizada cierran los conocidos. Los scripts de `prisma/` (`seed-*.ts`, `fix-*.ts`) deben correr contra un branch de pruebas antes de usarse (R-1 de la spec).
- **Reversión:** `DROP TRIGGER "trg_journalentry_balance" ON "JournalEntry"; DROP FUNCTION fn_check_journal_balance();` (sin pérdida de datos).

## Forma real del error (medida, no supuesta)
Medida contra Postgres real con Prisma 7.8 + adapter-pg (la primera corrida del job de integración del CI la dejó en evidencia: los tests de mensaje fallaban):
- **`prisma.$transaction(async tx => …)` explícito** —como escriben todos los servicios financieros— y **sentencias sueltas** (`update`/`delete`): el COMMIT diferido falla con `DriverAdapterError` y la información del motor viaja en `cause` (`code: "CF001"`, `originalCode`, `originalMessage`). `isUnbalancedEntryError` lo reconoce y el usuario ve el mensaje de negocio.
- **Escritura anidada suelta fuera de un `$transaction`** (`prisma.transaction.create({ …, entries: { create } })`): Prisma usa una transacción implícita; si su COMMIT falla, Prisma lo oculta tras un `P2028` genérico ("Transaction already closed: A rollback cannot be executed on a committed transaction") y el error del trigger **ya no viaja** en el objeto. La escritura se rechaza igual y no deja nada (fail-closed), pero el mensaje específico no llega: cae al genérico de base de datos. No se mapea un `P2028` al mensaje de cuadre porque ese código puede tener otras causas. Consecuencia práctica: la regla del proyecto "`$transaction` obligatorio en toda mutación financiera" es también lo que garantiza el mensaje claro.
- Con el adaptador de Neon (producción) la forma exacta puede diferir: el detector no depende de ella (recorre el error entero) y se comprueba en producción con una transacción descuadrada que se revierte sola.

## Despliegue
La migración se aplica en producción **después** de que el código de este PR esté desplegado: el trigger es estricto (T = 0) y el código anterior de `InvoiceGLPostingService` no cuantizaba; con el trigger activo y el código viejo, una factura con un total de más de 2 decimales fallaría al guardarse. Orden: merge → despliegue de `main` en Vercel → aplicar la migración → prueba de humo.

## Alternativas descartadas
- **`CHECK` constraint:** no puede agregar entre filas.
- **Trigger por sentencia (`FOR EACH STATEMENT`) no diferido:** valida en cada sentencia, no al COMMIT; rompe el insertado línea por línea.
- **Tolerancia de 0,01 (T = 0,01):** la contadora pidió cuadre exacto; permitiría un asiento descuadrado de un céntimo y que el balance derive.
- **Solo validación en la aplicación (statu quo):** deja abiertas todas las vías que no pasan por los servicios.

## Verificación
- Integración con Postgres real (`src/__tests__/integration/gl-balance-trigger.test.ts`, corre en el job `integration` del CI contra un branch efímero de Neon con todas las migraciones aplicadas desde cero): CA-2 a CA-6 de la spec, T = 0 exacto, anulación, asiento sin líneas, y traducción del error real de Prisma.
- Comprobación local previa con PGlite (Postgres en WASM): 17 escenarios, incluida la aplicación doble de la migración (idempotente).
- Prueba de humo en producción tras aplicar: una transacción descuadrada que se revierte sola (no deja datos) debe fallar con `CF001`.
