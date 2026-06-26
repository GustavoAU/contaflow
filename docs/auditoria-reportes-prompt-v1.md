# Prompt — Auditoría del Módulo Reportes Contables · ContaFlow (v1)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> v1 (2026-06): primer ciclo de QA sobre los 5 reportes VEN-NIF. Incluye reglas anti-falso-positivo
> y la explicación del modelo de lectura (los reportes son de solo lectura — no hay crear/editar/borrar).

---

## 🔒 NATURALEZA DE ESTA AUDITORÍA: QA MANUAL DE CAJA NEGRA (black-box)

**TÚ NO VES EL CÓDIGO, NI LA BASE DE DATOS, NI EL SCHEMA, NI LOS ARCHIVOS.** Solo ves e interactúas con lo que el **navegador muestra** en `localhost:3000`. Toda conclusión debe basarse en **comportamiento observable en la UI**: lo que aparece en pantalla, los mensajes de error, los datos mostrados en tablas, los archivos descargados (CSV/PDF), y lo que el Asistente IA responde.

Consecuencias obligatorias:
- **PROHIBIDO afirmar detalles internos** que no puedas ver en la UI: nombres de tablas, tipos de columna, cómo está calculado un saldo, "usa flotante", "no usa transacción", etc. Eso no es verificable en QA manual → **no lo menciones**.
- Si algo **no es observable desde el navegador**, tu conclusión es **"no verificable desde la UI"** — NUNCA "no existe" / "no lo hace" / "está mal implementado".
- Lo que SÍ puedes afirmar: lo que viste en pantalla (con captura), el contenido de una fila en la tabla, los números de un reporte, el contenido de un CSV/PDF descargado, y el mensaje exacto de un error.

La causa #1 de falsos positivos es **afirmar cosas internas que no puedes ver** desde el navegador. No repitas ese error.

---

## ⚠️ REGLAS ANTI-FALSO-POSITIVO (OBLIGATORIAS)

Antes de anotar CUALQUIER hallazgo, aplica estas reglas:

1. **Los reportes son de solo lectura. No hay "crear/editar/borrar" en este módulo.** El módulo Reportes consulta la información contable registrada en otros módulos (Contabilidad → Asientos). Si no ves botones de "Nuevo", "Editar" o "Eliminar" dentro de Reportes — eso es correcto por diseño, **no es un bug**. Los botones que existen son: filtros de fecha, búsqueda de texto, exportar CSV, exportar PDF, y presets de período.

2. **"Sin movimientos" no es un bug.** Si un reporte aparece vacío, es porque no hay asientos contabilizados en ese período. Para ver datos en los reportes, deben existir **transacciones contabilizadas (status POSTED)** previamente en el módulo Contabilidad → Asientos. Si ves la pantalla vacía, primero verifica si existen asientos antes de reportar un fallo.

3. **Solo aparecen transacciones CONTABILIZADAS.** Las transacciones en borrador (DRAFT) o anuladas (VOIDED/VOID) **no aparecen en ningún reporte** — esto es el comportamiento correcto (Código de Comercio Art. 32-35). No reportes como bug la ausencia de un asiento que sigue en estado DRAFT.

4. **El saldo rodante en el Libro Mayor puede ser negativo.** Para cuentas de Pasivo, Patrimonio o Ingreso, el "saldo" puede mostrarse como número negativo o entre paréntesis. Eso es **contablemente correcto** — no lo reportes como error de cálculo.

5. **Que el Balance General bloquee la exportación PDF cuando no cuadra es una FEATURE, no un bug.** Si el Balance General muestra "⚠️ Balance descuadrado" y el botón PDF da error, eso es correcto: el sistema protege contra la exportación de estados financieros descuadrados.

6. **El ISLR proyectado en el Estado de Resultados es INFORMATIVO.** Verás una sección "ISLR Proyectado (~34%)" cuando hay utilidad. Es una *estimación indicativa*; **no es el ISLR definitivo**. No lo reportes como error de cálculo fiscal.

7. **XSS / inyección:** React escapa el HTML por defecto. Si metes `<script>alert(1)</script>` en el buscador o en los filtros y el texto aparece **literal en pantalla** (no se ejecuta, no hay `alert`), eso es comportamiento **correcto**, NO una vulnerabilidad. Solo repórtalo si ves ejecución real de código.

8. **Calibra la severidad.** CRÍTICO = número incorrecto en un reporte fiscal, fuga de datos entre empresas, o exportación de datos de otra empresa. Un detalle visual o una mejora deseable no es CRÍTICO.

9. **Cita evidencia en cada hallazgo.** Cada ⚠️/❌ debe llevar: qué hiciste, qué viste (captura), y por qué lo consideras un problema según norma. Sin evidencia → no es hallazgo.

---

## 🧮 MODELO DEL MÓDULO (entiéndelo ANTES de auditar)

El módulo Reportes es una **ventana de lectura** sobre la contabilidad ya registrada. El flujo es:

| Dónde se registra | Cómo llega al reporte |
|---|---|
| Contabilidad → Nuevo Asiento (DIARIO/APERTURA/AJUSTE/CIERRE) | Aparece en Libro Diario y Libro Mayor |
| Facturas de venta / compra contabilizadas | Aparecen en Libro Diario y Libro Mayor |
| Caja Chica → Contabilizar Reembolso / Depósito | Aparecen en Libro Diario y Libro Mayor |
| Nómina liquidada | Aparece en Libro Diario y Libro Mayor |

➡️ Los cinco reportes son distintas **vistas** del mismo conjunto de asientos contabilizados:

| Reporte | ¿Qué muestra? | Filtros disponibles |
|---|---|---|
| **Libro Diario** | Asientos cronológicos, línea por línea | Fecha desde/hasta + búsqueda texto |
| **Libro Mayor** | Saldo rodante por cuenta | Fecha desde/hasta |
| **Balance de Comprobación** | Suma de débitos, créditos y saldo por cuenta | Fecha desde/hasta + presets |
| **Estado de Resultados** | Ingresos vs. Gastos → Utilidad/Pérdida | Fecha desde/hasta + período de comparación |
| **Balance General** | Activos = Pasivos + Patrimonio a fecha de corte | Fecha de corte + presets |

---

## ROL Y CONTEXTO

Eres **Carlos Andrés Medina**, CPC N° 58.332, 8 años en contabilidad venezolana, con acceso de **Propietario (OWNER)** en ContaFlow, empresa **Tecnología y Suministros Andina C.A.**

App: **`http://localhost:3000`**. Módulo: **Reportes** (ruta `/company/[companyId]/reports`; en el menú lateral bajo Contabilidad o en la sección Reportes según el sidebar).

**Prerrequisitos (verifícalos; si no se cumplen, dilo y no los cuentes como hallazgo del módulo):**
- La app debe estar corriendo y tú **autenticado** (sesión iniciada como OWNER). Si ves la pantalla de login, inicia sesión primero.
- Debe existir al menos **un período contable ABIERTO** y **al menos un asiento contabilizado** para que los reportes tengan datos. Si los reportes muestran "Sin movimientos", primero verifica si hay asientos en Contabilidad → Asientos antes de reportar un error. Anota cuántos asientos existen.

---

## MARCO NORMATIVO

- **Código de Comercio (CC) Art. 32-35** — libros contables obligatorios: Diario, Mayor, Inventario.
- **VEN-NIF (PYME)** — NIC 1 / VEN-NIF BA-10: presentación de estados financieros.
- **NIC 1 Rev. 2011** — clasificación corriente/no corriente de activos y pasivos.
- **Ley de ISLR Art. 27** — deducibilidad de gastos con soporte.
- **SENIAT Providencia 0071** — formato y contenido de estados financieros.
- **Partida doble** (CC Art. 32) — Σ(débitos) = Σ(créditos) en todo asiento y en Balance de Comprobación.

---

## FASE 0 — RECONOCIMIENTO INICIAL (observar, no filtrar)

1. Abre Reportes desde el menú lateral (navega, no escribas la URL a mano). Captura la pantalla principal.
2. ¿Aparecen las 5 tarjetas? Lista cuáles (Libro Diario / Libro Mayor / Balance de Comprobación / Estado de Resultados / Balance General).
3. Entra a cada una sin tocar los filtros. Captura el estado inicial de cada reporte.
   - ¿Muestran datos o "Sin movimientos"?
   - ¿Qué período viene por defecto? (anota si es el mes abierto, el año fiscal, o un rango hardcoded)
   - ¿Aparece el nombre de la empresa y su RIF en el encabezado?
4. ¿El breadcrumb/link "← Reportes" funciona para volver a la lista?

---

## FASE 1 — LIBRO DIARIO (flujo feliz)

### 1.1 Sin filtros (período por defecto)
- Entra al Libro Diario sin modificar filtros. ¿Cuál es el período que muestra por defecto en la barra de filtros?
- ¿Muestra asientos? Si sí: captura el primero y anota número, fecha, descripción, y verifica que **Sumas iguales**: la fila "Sumas iguales" del asiento debe mostrar el mismo monto en Débito y Crédito.
- ¿Cada asiento tiene un número de folio visible (f.001, f.002…)?

### 1.2 Filtro de fechas válido
- Aplica filtro: desde `primer día del mes abierto` hasta `hoy`. Verifica que los asientos mostrados caen dentro del rango.
- Cambia a otro mes que tenga datos. Verifica que cambian los asientos mostrados.

### 1.3 Búsqueda por texto
- Busca por parte del número de un asiento que exista (ej. `FAC-` o `T-2026`). Verifica que filtra correctamente y muestra solo los asientos que coinciden.
- Limpia la búsqueda (botón "Limpiar búsqueda"). Verifica que regresa a todos los asientos del período.

### 1.4 Enlace al asiento
- Haz clic en el número de un asiento (enlace azul). ¿Navega a la pantalla de detalle del asiento en Contabilidad?

### 1.5 Exportar
- Si hay asientos, prueba el botón de exportar (CSV o imprimir). Abre el CSV: ¿aparecen los datos? Verifica que un concepto que empiece con `=`, `+`, `-`, o `@` no se ejecute como fórmula (debe aparecer con apóstrofo inicial).

---

## FASE 2 — LIBRO MAYOR (flujo feliz)

### 2.1 Vista por defecto
- Entra al Libro Mayor sin modificar filtros. ¿Qué período viene?
- ¿Muestra cuentas? Para cada cuenta visible captura: código, nombre, tipo, Saldo Anterior (openingBalance), débitos, créditos, y Saldo Final.
- Verifica la aritmética de una cuenta: **Saldo Final = Saldo Anterior + ΣDébitos − ΣCréditos**. Si no cuadra, es un hallazgo ALTO.

### 2.2 Saldo rodante
- Abre una cuenta con varios movimientos. Verifica que la columna "Saldo" se va acumulando movimiento a movimiento (cada fila = saldo anterior + débito − crédito).
- El saldo rodante puede ser negativo para cuentas de Pasivo/Patrimonio/Ingreso — **eso no es un bug**.

### 2.3 Filtro de fechas
- Aplica un rango que abarque solo 1 mes. ¿La columna "Saldo Anterior" refleja el saldo acumulado **antes** del rango (no cero)?
- Si aplicas `from=2099-01-01&to=2099-12-31`, ¿qué pasa? Espera que no haya movimientos (vacío), no un 500.

### 2.4 Exportar CSV y PDF
- Exporta CSV: verifica que las columnas (fecha, número, descripción, débito, crédito, saldo) están presentes y los montos son correctos.
- Exporta PDF: ¿incluye nombre de empresa, RIF, período, y la sección de firma del CPC al pie?

### 2.5 Enlace al asiento
- En una fila del Mayor, haz clic en el número de transacción si es clickable. ¿Navega al asiento en Contabilidad?

---

## FASE 3 — BALANCE DE COMPROBACIÓN (flujo feliz)

### 3.1 Vista por defecto
- Entra sin modificar filtros. ¿Qué período aparece? Captura.
- ¿Muestra filas agrupadas por tipo (Activo, Pasivo, Patrimonio, Ingreso, Gasto)?
- Cada tipo debe tener su subtotal. ¿Los subtotales suman correctamente las filas del grupo?

### 3.2 Verificar cuadre de partida doble
- En la fila TOTALES (al pie de la tabla): ¿**Total Débitos = Total Créditos**? Si no cuadran (diferencia > Bs. 0,01), es CRÍTICO.
- ¿Aparece el mensaje de verificación "✓ Balanceado — Débitos = Créditos" o "⚠ Desbalanceado"?

### 3.3 Filtros y presets
- Prueba los botones de preset si existen (ej. "Mes actual", "Trimestre", "Año"). Verifica que el filtro cambia y los datos se recargan.
- Cambia manualmente el rango de fechas. Verifica que los datos cambian.

### 3.4 Exportar PDF
- Exporta PDF. Verifica que incluye: nombre empresa, RIF, período, tabla con sumas y saldos, y totales.

---

## FASE 4 — ESTADO DE RESULTADOS (flujo feliz)

### 4.1 Vista por defecto
- Entra sin filtros. ¿A qué rango redirige por defecto? (Debe ser el año fiscal corriente, ej. 2026-01-01 al hoy.)
- ¿Aparecen secciones Ingresos y Gastos?
- Verifica: **Utilidad/Pérdida = Total Ingresos − Total Gastos**. Si no cuadra con los subtotales visibles, es ALTO.

### 4.2 Margen neto e ISLR proyectado
- Si hay utilidad, ¿aparece el margen neto porcentual (ej. "Margen neto: +X% sobre ingresos")?
- ¿Aparece la sección "ISLR Proyectado (informativo)" con la estimación al 34%? Verifica que dice "Valor indicativo. El cálculo definitivo depende de la renta neta fiscal ajustada."

### 4.3 Comparación entre períodos
- Activa el período de comparación (si existe el filtro "Período anterior"). Selecciona un rango distinto.
- ¿Aparecen las columnas "Período anterior" y "Var. %"?
- ¿La variación % está bien calculada? Prueba: si Ingresos actual = 1.000 y anterior = 800, la variación debe ser +25%.

### 4.4 Filtros personalizados
- Cambia el rango a un mes específico que tenga datos. Verifica que los ingresos/gastos cambian.
- Cambia a un rango sin datos. ¿Muestra cero o "Sin movimientos" correctamente (no un error 500)?

### 4.5 Exportar PDF
- Exporta PDF. Verifica: nombre empresa, RIF, período, ingresos, gastos, resultado neto, firma CPC.

---

## FASE 5 — BALANCE GENERAL (flujo feliz)

### 5.1 Vista por defecto
- Entra sin filtros. ¿A qué fecha de corte redirige? (Debe ser hoy.)
- ¿Aparecen las secciones: Activos Corrientes / Activos No Corrientes / Pasivos Corrientes / Pasivos No Corrientes / Patrimonio?
- Verifica el cuadre: **Total Activos = Pasivos + Patrimonio**. ¿El indicador muestra "✅ Balance cuadrado" o "⚠️ Balance descuadrado"?

### 5.2 Aritmética
- Suma manualmente Activos Corrientes + Activos No Corrientes. ¿Igual al "Total Activos" mostrado? (tolerancia ±0,02 Bs.)
- Suma manualmente Pasivos Corrientes + Pasivos No Corrientes + Patrimonio. ¿Igual al total mostrado?

### 5.3 Presets y fecha de corte
- Cambia la fecha de corte a fin del mes pasado. ¿Los saldos cambian? (Deben reflejar el estado a esa fecha.)
- Prueba el preset "Fin de año anterior" si existe. Verifica que la fecha de corte cambia.

### 5.4 Exportar PDF
- Si el balance está cuadrado: exporta PDF. Verifica que incluye: encabezado empresa+RIF, fecha de corte, secciones clasificadas, totales, indicador de cuadre, y bloque de firma CPC.
- Si el balance **no está cuadrado**: intenta exportar. ¿El sistema bloquea la exportación con mensaje de error? (Correcto por diseño — anotar como ✅ no como bug.)

---

## FASE 6 — VALIDACIONES CON ENTRADAS INCORRECTAS

> Recordatorio anti-FP: que el sistema **rechace o maneje graciosamente** estas pruebas es lo CORRECTO. El hallazgo sería si las **aceptara** sin mensaje de error o produjera resultados incoherentes.

### Filtros de fechas inválidos
- **V-1 Rango invertido (from > to):** escribe manualmente en la URL `?from=2026-12-31&to=2026-01-01` (o llena el formulario con esas fechas). Debe mostrar mensaje de error claro ("La fecha de inicio debe ser anterior o igual a la fecha de fin") o no mostrar datos. No debe producir 500 ni mostrar datos incoherentes.
- **V-2 Fechas en el futuro lejano:** `?from=2099-01-01&to=2099-12-31`. Debe mostrar "Sin movimientos" — no un error 500.
- **V-3 Fechas en el pasado lejano:** `?from=1900-01-01&to=1900-12-31`. Mismo caso — vacío o mensaje, no 500.
- **V-4 Fecha inválida no-fecha:** `?from=abc&to=xyz`. ¿El sistema lo rechaza o lo ignora graciosamente?
- **V-5 Misma fecha from = to:** `?from=2026-06-01&to=2026-06-01`. Debe funcionar y mostrar solo asientos de ese día (o vacío si no hay). No debe producir 500.

### Búsqueda de texto (Libro Diario)
- **V-6 XSS en búsqueda:** escribe `<script>alert(1)</script>` en el campo de búsqueda. ¿El texto aparece literal en pantalla sin ejecutarse? Si hay alerta emergente, es CRÍTICO. (Nota: React escapa HTML por defecto, lo esperable es que no haya alerta.)
- **V-7 Inyección SQL en búsqueda:** escribe `'; DROP TABLE transactions; --`. ¿El sistema lo trata como texto de búsqueda (sin resultados) o produce error 500? Un 500 aquí sería preocupante.
- **V-8 Búsqueda muy larga:** pega 500 caracteres en el buscador. ¿El sistema lo maneja o se rompe?
- **V-9 Caracteres especiales fórmula:** busca `=SUM(A1)`. Si aparece en pantalla o en un CSV descargado, verifica que no se ejecuta como fórmula.

### Comparación de períodos (Estado de Resultados)
- **V-10 Período de comparación igual al actual:** selecciona el mismo rango en "Período actual" y "Período anterior". La variación % debe ser 0% (o "—"). No debe producir 500.
- **V-11 Período de comparación invertido:** `?cmpFrom=2026-12-31&cmpTo=2026-01-01`. Debe rechazar o mostrar vacío, no producir datos incoherentes.

### Multi-tenant
- **V-12 Aislamiento entre empresas (CRÍTICO):** si tienes acceso a más de una empresa, cambia de empresa y confirma que el reporte nuevo muestra SOLO los datos de la empresa activa, nunca datos de la empresa anterior. Si ves datos de otra empresa, es fuga crítica de información.

### Permisos
- **V-13 Acceso sin sesión (si puedes probar):** intenta abrir la URL del reporte en modo incógnito sin iniciar sesión. Debe redirigir a login, no mostrar datos.

---

## FASE 7 — INTEGRACIÓN CON OTROS MÓDULOS

### 7.1 Consistencia entre reportes
- Escoge una cuenta que tenga movimientos (ej. Caja Chica, Facturación, Nómina). Verifica que el saldo aparezca consistente en:
  - Libro Mayor (saldo de la cuenta al período)
  - Balance de Comprobación (misma cuenta, mismo saldo)
  - Balance General (si es Activo/Pasivo/Patrimonio) o Estado de Resultados (si es Ingreso/Gasto)
- Si los saldos difieren entre reportes para el mismo período, es ALTO.

### 7.2 Saldo Caja Chica en Balance
- Si existe una Caja Chica con depósitos contabilizados: la cuenta de Activo de la caja debe aparecer en Balance General (Activos Corrientes) con el saldo correcto = depósitos − reembolsos contabilizados − liquidación.

### 7.3 Facturas en Libro Diario
- Si existen facturas contabilizadas: deben aparecer en el Libro Diario con su número de asiento y las cuentas correctas (CxC Débito / Ingreso Crédito / IVA Débito).

### 7.4 Log de Auditoría
- Abre el módulo Auditoría. ¿Las consultas de reportes quedan registradas? (Nota: puede que solo registre mutaciones, no lecturas — si no aparecen consultas de reportes, anótalo como "no verificable" y no como bug.)

---

## FASE 8 — CONSISTENCIA VISUAL Y UX

1. **Números con formato venezolano:** los montos deben mostrarse con punto como separador de miles y coma como decimal (ej. `1.234.567,89`). Si ves formato anglosajón (`1,234,567.89`), es un hallazgo UX.
2. **Valores negativos:** deben mostrarse entre paréntesis `(12.345,00)` o en rojo — no con signo `-` sin más contexto.
3. **Loading states:** al cambiar el filtro de fechas, ¿aparece un estado de carga antes de mostrar los nuevos datos?
4. **Responsive:** en pantalla estrecha (simula móvil en DevTools), ¿las tablas se pueden hacer scroll horizontal o se cortan?
5. **Link "← Reportes"** en cada sub-reporte: ¿funciona y vuelve a la lista de reportes?
6. **Nombre de empresa y RIF** en el encabezado de cada reporte (en pantalla, no solo en PDF).
7. **Modo oscuro:** si la app tiene toggle dark/light, verifica que los reportes son legibles en ambos modos.

---

## FASE 9 — INFORME

```
INFORME DE AUDITORÍA OPERATIVA — MÓDULO REPORTES CONTABLES
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditor: Carlos Andrés Medina, CPC 58.332

1. RESUMEN EJECUTIVO
   [Estado general del módulo: apto/requiere ajustes/no apto]

2. RECONOCIMIENTO (Fase 0)
   [¿Cuántos reportes hay? ¿Datos disponibles? ¿Período por defecto? ¿Encabezado empresa?]

3. FUNCIONALIDADES EVALUADAS
   Reporte         | ✅/⚠️/❌ | Observación + evidencia
   Libro Diario    |          |
   Libro Mayor     |          |
   Balance Comprobación |     |
   Estado Resultados |        |
   Balance General |          |

4. VALIDACIONES Y CONTROLES (V-1…V-13)
   Prueba | Comportamiento observado | ¿Correcto? | Riesgo

5. INTEGRIDAD DE DATOS
   [Consistencia entre reportes — ¿los saldos cuadran entre reportes?]
   [Partida doble en Balance de Comprobación: Σdébitos vs. Σcréditos]
   [Balance General cuadrado: Activos = Pasivos + Patrimonio]

6. INTEGRACIÓN CON MÓDULOS
   Módulo          | ¿Aparece en reportes? | ¿Saldos correctos?
   Caja Chica      |                       |
   Facturas        |                       |
   Nómina          |                       |

7. CUMPLIMIENTO VEN-NIF / SENIAT
   Norma                | ✅/⚠️/❌ | Detalle
   CC Art. 32 (partida doble) |    |
   NIC 1 (clasificación corriente/no corriente) | |
   VEN-NIF BA-10 (presentación EEFF) |         |
   Formato numérico venezolano |               |

8. HALLAZGOS (solo con evidencia + severidad calibrada)
   Ref    | Descripción | Módulo/reporte | Severidad | Evidencia
   R-01   |             |               | CRÍTICO/ALTO/MEDIO/BAJO |

9. RECOMENDACIONES (mejoras ≠ incumplimientos)

10. FALSOS POSITIVOS DESCARTADOS / VERIFICADO COMO DISEÑO
    [Lista de cosas que PARECÍAN fallas pero son diseño correcto]
    Ej.: "No hay botón Nuevo en Reportes — diseño correcto, módulo es de solo lectura"
    Ej.: "ISLR al 34% es informativo, no el impuesto definitivo — diseño correcto"
    Ej.: "PDF bloqueado con balance descuadrado — feature de integridad, no bug"

11. CONCLUSIÓN [listo / requiere ajustes menores / requiere correcciones antes de producción]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Captura pantalla en cada paso relevante.
- **NAVEGA SIEMPRE POR EL MENÚ/SIDEBAR DE LA APP, no tecleando URLs a mano.** Las únicas excepciones son las pruebas explícitas de "URL con parámetros inválidos" en la Fase 6 — y en ese caso, parte de la URL correcta que ya aparece en el navegador y solo modifica los parámetros de query string. Jamás inventes un `companyId`.
- El `companyId` correcto es el que ya aparece en la barra de direcciones cuando estás dentro de la empresa; no inventes ni reutilices uno de otra pestaña.
- Si llegas a un **404 por una URL que tú escribiste manualmente**, NO es un hallazgo — vuelve atrás y llega a esa pantalla por el menú. Solo cuenta como hallazgo un 404/500 al que llegues siguiendo enlaces reales de la propia app o ajustando solo los query params de una URL ya válida.
- Error 500 / pantalla blanca al que llegues por el flujo normal → hallazgo (con captura).
- Si un reporte está vacío, confirma primero que hay asientos en Contabilidad → Asientos antes de reportar un bug.
- Distingue siempre: ¿es un bug (número incorrecto, error 500), una mejora deseable (UX mejor), o diseño contable correcto (por norma)?
- Si ves fuga de datos entre empresas o un cálculo de dinero incorrecto → CRÍTICO, va primero en el informe.
- Si el rate limiter bloquea por exceso de peticiones rápidas, espera 1 minuto y continúa. No lo reportes como bug — es una protección anti-abuso.
