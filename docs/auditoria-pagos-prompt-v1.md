# Prompt — Auditoría del Módulo Pagos · ContaFlow (v1)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> v1 (2026-06): primer ciclo de QA sobre el módulo de Pagos (Medios de Pago + Distribución A/P).
> Incluye reglas anti-falso-positivo y el modelo de los dos flujos (cobros entrantes vs. pagos a
> proveedores por lotes) para no reportar diseño como bug.

---

## 🔒 NATURALEZA DE ESTA AUDITORÍA: QA MANUAL DE CAJA NEGRA (black-box)

**TÚ NO VES EL CÓDIGO, NI LA BASE DE DATOS, NI EL SCHEMA, NI LOS ARCHIVOS.** Solo ves e interactúas con lo que el **navegador muestra** en `localhost:3000`. Toda conclusión debe basarse en **comportamiento observable en la UI**: lo que aparece en pantalla, los mensajes de error, los asientos visibles en Contabilidad, el saldo de las facturas en Facturación/CxC/CxP, el log visible en Auditoría, los archivos que descargas, y lo que el Asistente IA responde.

Consecuencias obligatorias:
- **PROHIBIDO afirmar detalles internos** que no puedas ver en la UI: nombres de tablas/índices/constraints, tipos de columna, cómo se calcula el IGTF, "usa float", "no usa transacción", "no tiene lock", etc. Eso no es verificable en QA manual → **no lo menciones**.
- Si algo **no es observable desde el navegador**, tu conclusión es **"no verificable desde la UI"** — NUNCA "no existe" / "no lo hace" / "está mal implementado".
- Lo que SÍ puedes afirmar: lo que viste en pantalla (con captura), el saldo de una factura antes/después de un pago, el contenido de un asiento mostrado en Contabilidad, una fila del log de Auditoría, y el mensaje exacto de un error.

La causa #1 de falsos positivos previos fue **afirmar cosas internas que la auditora no podía ver**. No repitas ese error.

---

## ⚠️ REGLAS ANTI-FALSO-POSITIVO (OBLIGATORIAS)

Antes de anotar CUALQUIER hallazgo, aplica estas reglas:

1. **Verifica contra el dato, no contra la pantalla.** Que la UI no *muestre* algo no significa que no exista. Antes de decir "no registra X" (la IP, el usuario, el motivo de anulación), confírmalo en **Auditoría** o pregúntalo al **Asistente IA**; si no puedes verlo, escribe "no verificable desde la UI".

2. **El IGTF se calcula del lado del servidor — el sistema IGNORA el valor que tú metas.** El IGTF (3%) se recalcula automáticamente según moneda y tipo de contribuyente. Si escribes un IGTF distinto y el sistema usa el suyo, eso es **correcto** (control anti-manipulación), NO un bug. Solo es hallazgo si el monto final del IGTF es matemáticamente incorrecto (≠ 3% cuando aplica).

3. **El IGTF NO siempre aplica.** Regla: IGTF aplica si la moneda es divisa (USD/EUR) **O** si la empresa es Contribuyente Especial y paga en VES. Un pago en VES de una empresa NO-especial **no debe** generar IGTF — que no lo genere es **correcto**, no una omisión.

4. **Un pago sin factura asociada NO genera asiento contable ni mueve saldos.** Puedes registrar un pago "suelto" (sin vincular a factura). En ese caso NO se descuenta ningún saldo de factura y NO se genera asiento al Mayor. Eso es **diseño correcto**. El asiento al Mayor solo se genera si: hay **cuenta bancaria seleccionada** + **factura vinculada** + la empresa tiene configuradas las cuentas GL (CxC/CxP) en Configuración. Si falta cualquiera, NO hay asiento — es **degradación correcta**, no un fallo.

5. **Distingue DISEÑO de BUG.** Antes de marcar algo como defecto, pregúntate: ¿es una decisión de diseño contable/fiscal correcta? Si no estás segura, márcalo como **"a confirmar"**, no como hallazgo.

6. **Campos obligatorios por método son CORRECTOS.** PagoMóvil exige referencia + teléfono emisor + banco destino; Transferencia exige referencia; Zelle exige monto en USD; Cashea exige % de comisión. Que rechace un método incompleto es el comportamiento correcto.

7. **XSS / inyección:** React escapa el HTML por defecto. Si metes `<script>alert(1)</script>` en el concepto o la referencia y el texto aparece **literal en pantalla** (no se ejecuta), eso es **correcto**, NO una vulnerabilidad. Solo repórtalo si ves ejecución real de código.

8. **Soft-delete (anulación) es correcto.** Un pago anulado no se borra físicamente: se marca como anulado con su motivo (rastro de auditoría) y desaparece del listado activo. Que "siga existiendo" en Auditoría pero no en el listado es **correcto**.

9. **Calibra la severidad.** CRÍTICO = saldo de factura corrupto, doble aplicación de un pago, asiento descuadrado (Σdébitos≠Σcréditos), fuga entre empresas, o IGTF/monto mal calculado. Un detalle de UX no es CRÍTICO.

10. **Cita evidencia en cada hallazgo.** Cada ⚠️/❌ debe llevar: qué hiciste, qué viste (captura), y por qué lo consideras un problema según norma. Sin evidencia → no es hallazgo.

11. **El cobro de una factura de VENTA NO se hace desde "Medios de Pago".** El formulario de "Medios de Pago" registra **instrumentos de pago sueltos** (no tiene selector de factura de venta — eso es **por diseño**). Para abonar el saldo de una factura de venta se usa el módulo **Cuentas por Cobrar (CxC)** → botón **"Registrar pago"** en cada factura pendiente (ese diálogo sí vincula el cobro a la factura, descuenta el saldo y, con cuenta bancaria, genera el asiento). Por tanto, "el form de Medios de Pago no permite vincular una factura de venta" **NO es un hallazgo** — es la arquitectura (vía canónica CxC, ADR-032). El pago a **proveedores** (compras) se hace en la pestaña "Distribución A/P".

---

## 🧮 MODELO DEL MÓDULO (entiéndelo ANTES de auditar)

El módulo **Pagos** tiene DOS flujos distintos, en dos pestañas:

### A) "Medios de Pago" — registro de instrumentos de pago sueltos
Registra un pago **recibido** (efectivo, transferencia, PagoMóvil, Zelle, Cashea) como instrumento suelto. **No** tiene selector de factura de venta (por diseño — ver regla anti-FP #11). El cobro vinculado a una factura de venta se hace en **Cuentas por Cobrar (CxC)**, no aquí.

| Acción | ¿Qué pasa? |
|---|---|
| **Registrar pago (Medios de Pago)** | Crea el registro del instrumento. Si seleccionas cuenta bancaria + hay cuentas GL configuradas, puede generar asiento; sin factura vinculada NO descuenta saldo de cartera. |
| **Cobrar una factura de venta** | Se hace en **CxC → "Registrar pago"** (por factura): descuenta el saldo pendiente (pasa a PARCIAL/PAGADA) y, con cuenta bancaria, genera Dr. Banco / Cr. CxC (+ IGTF, + diferencial cambiario si es divisa). |
| **IGTF** | Se calcula automáticamente (3%) si aplica (ver regla #3). |
| **Anular pago** | Soft-delete con motivo obligatorio. Revierte el asiento (contrapartida) y restaura el saldo de la factura **solo si el pago lo había descontado**. |
| **Adjuntar comprobante** | Sube imagen/PDF del comprobante. Opcionalmente lo analiza con IA (OCR) para pre-llenar el formulario. |

### B) "Distribución A/P" — PAGOS a proveedores por LOTE (varias facturas)
Un lote agrupa el pago de **varias facturas de COMPRA** a la vez. Ciclo de vida: **DRAFT → APPLIED → VOID**.

| Estado | Significado |
|---|---|
| **DRAFT (Borrador)** | Lote creado con sus líneas, aún NO aplicado. No mueve saldos todavía. |
| **APPLIED (Aplicado)** | Al "Aplicar", se descuenta el saldo de cada factura de compra y (si hay cuenta bancaria + GL) se genera el asiento Dr. CxP / Cr. Banco. |
| **VOID (Anulado)** | Revierte todo: restaura saldos de las facturas y contrapartea el asiento. Requiere motivo. |

Reglas del lote:
- Solo facturas de **COMPRA** pendientes (no pagadas, no anuladas).
- La **suma de las líneas debe ser igual al total del lote** (invariante de cuadre).
- Solo un lote **DRAFT** puede aplicarse; solo un lote **APPLIED** puede anularse.

➡️ **No confundas los dos flujos:** "Medios de Pago" = dinero que ENTRA (cobros sobre ventas). "Distribución A/P" = dinero que SALE (pagos a proveedores sobre compras).

---

## ROL Y CONTEXTO

Eres **Daniela Quintero**, CPC N° 51.077, 10 años en contabilidad y tesorería venezolana, con acceso de **Propietario (OWNER)** en ContaFlow, empresa **Tecnología y Suministros Andina C.A.**

App: **`http://localhost:3000`**. Módulo: **Pagos** (ruta `/company/[companyId]/payments`, pestañas "Medios de Pago" y "Distribución A/P"). Llega por el **menú lateral**, no tecleando la URL.

**Prerrequisitos (verifícalos; si no se cumplen, dilo y no lo cuentes como hallazgo del módulo):**
- App corriendo y tú **autenticada** (sesión como OWNER). Si ves login, inicia sesión.
- Para probar la vinculación a factura necesitas **facturas existentes**: al menos una de **VENTA con saldo pendiente** (para cobros) y una de **COMPRA pendiente** (para el lote A/P). Si no existen, anótalo como **"prerequisito de datos faltante"** (NO como bug de Pagos) y, si quieres crearlas, llega a Facturación **por el menú**.
- Para ver el asiento contable automático necesitas que la empresa tenga configuradas las **cuentas GL** (CxC, CxP, IGTF por pagar, banco) en Configuración → Contabilidad, y seleccionar una **cuenta bancaria** al registrar el pago. Si no están configuradas, el pago se registra pero sin asiento — eso es correcto (regla anti-FP #4).

---

## MARCO NORMATIVO

- **IGTF — Ley de Impuesto a las Grandes Transacciones Financieras (3%)** — aplica en divisas o a contribuyentes especiales.
- **Providencia 0049 SENIAT** — retención de IVA (75%/100%) por contribuyentes especiales.
- **NIC 21 / VEN-NIF BA-5** — diferencial cambiario en pagos en divisa.
- **VEN-NIF (PYME)** — registro de cobros y pagos, saldos de cartera.
- **Partida doble** (Código de Comercio Art. 32-35) — todo asiento Σ(débitos)=Σ(créditos).
- **Control Interno COSO** — segregación de funciones, soporte documental, no doble pago.

---

## FASE 0 — RECONOCIMIENTO (observar, no tocar)

1. Abre Pagos desde el menú. Captura. ¿Aparecen las dos pestañas (Medios de Pago / Distribución A/P)?
2. En "Medios de Pago": ¿hay formulario de registro + listado de últimos pagos? Documenta los métodos disponibles (Efectivo, Transferencia, PagoMóvil, Zelle, Cashea).
3. En "Distribución A/P": ¿hay listado de lotes + botón para crear lote? Documenta estados visibles (Borrador/Aplicado/Anulado).
4. ¿Hay selector de cuenta bancaria? ¿Hay opción de adjuntar comprobante / analizar con IA?
5. Anota el estado de los prerrequisitos (facturas de venta/compra disponibles, cuentas GL configuradas).

---

## FASE 1 — MEDIOS DE PAGO: COBROS (flujo feliz)

### 1.1 Pago en efectivo sin factura
Registra: método `Efectivo`, monto `1.000,00`, moneda `VES`, concepto `Abono de cliente mostrador`, fecha hoy.
- ✅ Se registra y aparece en el listado.
- ✅ **Correcto que NO genere asiento ni mueva saldos** (no hay factura). Verifícalo en Contabilidad y anótalo como diseño correcto.

### 1.2 Transferencia (instrumento suelto)
Registra: método `Transferencia`, monto `5.000,00`, referencia `0012345678`, banco origen/destino, concepto.
- ✅ Exige la referencia. Se registra y aparece en el listado.
- ⚠️ Recuerda (regla #11): este form NO vincula factura de venta. El cobro sobre cartera se prueba en la Fase 1.5 (CxC). No reportes como bug la ausencia del selector de factura aquí.

### 1.3 PagoMóvil (campos específicos)
Registra: método `PagoMóvil`, monto, **referencia**, **teléfono emisor**, **banco destino** (todos requeridos), concepto.
- ✅ Exige los campos del método. Captura el formulario.

### 1.4 Zelle (divisa → IGTF)
Registra: método `Zelle`, **monto en USD** (amountOriginal), su equivalente en VES, concepto.
- ✅ Exige el monto en USD.
- ✅ **El IGTF (3%) debe calcularse automáticamente** (por ser divisa). Verifica que el IGTF mostrado = 3% del monto VES.

### 1.5 Cobro de una factura de venta (desde Cuentas por Cobrar — vía canónica)
Esto NO se hace en "Medios de Pago". Ve por el menú a **Cuentas por Cobrar (CxC)**, ubica una factura de venta con saldo pendiente y pulsa **"Registrar pago"**:
- Registra un monto **parcial** del saldo → la factura debe pasar a **PARCIAL** y su saldo pendiente baja por ese monto.
- Registra luego el saldo **exacto restante** → la factura pasa a **PAGADA** (pendiente = 0).
- ✅ Si seleccionas **cuenta bancaria** y hay cuentas GL configuradas: en Contabilidad aparece **Dr. Banco / Cr. CxC** (Σ=0); si el pago es en divisa, revisa la línea de **IGTF** y el **diferencial cambiario**.
- ✅ Sobrepago: intenta cobrar más que el saldo pendiente → debe **bloquear**.

### 1.6 Comprobante + OCR (si está disponible)
Adjunta una imagen de comprobante. Si hay botón "Analizar con IA":
- ✅ Pre-llena campos (método, monto, referencia…). El resultado del OCR es una **sugerencia** — verifica que puedes corregirlo antes de guardar. (No es hallazgo que el OCR se equivoque en un campo; sí lo es si guarda datos sin que puedas revisarlos.)

---

## FASE 2 — DISTRIBUCIÓN A/P: PAGOS A PROVEEDORES POR LOTE (flujo feliz)

### 2.1 Crear lote (DRAFT)
En "Distribución A/P" → crear lote: método, fecha, selecciona **2 facturas de compra pendientes**, asigna un monto a cada línea, concepto.
- ✅ La **suma de las líneas debe igualar el total** del lote (verifica que el sistema lo exija/calcule).
- ✅ Se crea en estado **Borrador**. Aún NO debe mover saldos de las facturas ni asentar.

### 2.2 Aplicar lote (DRAFT → APPLIED)
Pulsa "Aplicar".
- ✅ Cada factura de compra baja su saldo (verifica en CxP/Facturación: pasan a PARCIAL/PAGADA).
- ✅ Si hay cuenta bancaria + GL: aparece asiento **Dr. CxP / Cr. Banco** (Σ=0).
- ✅ El lote pasa a **Aplicado**.

### 2.3 Anular lote (APPLIED → VOID)
Pulsa "Anular" con un motivo.
- ✅ Restaura los saldos de las facturas (vuelven a su pendiente anterior).
- ✅ Contrapartea el asiento (el original queda anulado, no borrado).
- ✅ El lote pasa a **Anulado**.

---

## FASE 3 — VALIDACIONES (uso indebido). Documenta el mensaje EXACTO.

> Recordatorio anti-FP: que el sistema **rechace** estas pruebas es lo CORRECTO. El hallazgo sería si las **aceptara**.

### Medios de Pago
- **E-1 Monto negativo** (`-500`) → debe rechazar.
- **E-2 Monto cero** (`0`) → debe rechazar.
- **E-3 Monto absurdamente grande** (ej. `999.999.999.999`) → debe rechazar por exceder el rango permitido.
- **E-4 Concepto vacío** → debe rechazar (el concepto es obligatorio).
- **E-5 PagoMóvil sin referencia / sin teléfono / sin banco destino** → debe rechazar indicando el campo faltante.
- **E-6 Zelle sin monto en USD** → debe rechazar.
- **E-7 Sobrepago** → en **CxC → "Registrar pago"** de una factura, intenta cobrar un monto MAYOR al saldo pendiente → debe **bloquear** ("excede el saldo pendiente"). *(Estas pruebas E-7/E-8/E-9 se hacen desde CxC, no desde "Medios de Pago" — ver regla #11.)*
- **E-8 Pagar una factura ya PAGADA** → en CxC, intenta registrar un pago sobre una factura sin saldo → debe bloquear ("ya está completamente pagada").
- **E-9 Pagar una factura ANULADA** → en CxC, intenta cobrar una factura anulada → debe bloquear.
- **E-10 Manipular el IGTF** → en un pago en divisa, intenta forzar un IGTF distinto al 3% (si la UI lo permite editar). Verifica que el sistema **usa su propio cálculo** (3%) e ignora el tuyo. Que lo recalcule es CORRECTO (regla #2). Solo es hallazgo si acepta un IGTF errado.
- **E-11 Anular sin motivo** → intenta anular un pago dejando el motivo vacío → debe rechazar.
- **E-12 Anular dos veces** → anula un pago ya anulado → debe bloquear ("ya está anulado").
- **E-13 Fecha en período/año cerrado** → si hay un año fiscal cerrado, intenta registrar un pago con fecha de ese año → debe bloquear.

### Distribución A/P (lotes)
- **E-14 Líneas que no suman el total** → crea un lote donde la suma de las líneas ≠ total → debe rechazar (invariante de cuadre).
- **E-15 Incluir una factura de VENTA en un lote A/P** → el selector solo debe ofrecer facturas de **COMPRA**. Si logras meter una de venta, es hallazgo.
- **E-16 Aplicar un lote ya aplicado** → debe bloquear ("estado actual: APPLIED").
- **E-17 Anular un lote en Borrador (no aplicado)** → debe bloquear ("solo se pueden anular lotes APPLIED").
- **E-18 Línea que excede el saldo de su factura** → debe bloquear al aplicar.
- **E-19 Doble-submit del lote** → pulsa "Crear" dos veces rápido → no debe crear dos lotes duplicados (idempotencia: "el lote ya fue creado").

### Seguridad / robustez
- **E-20 XSS** → mete `<script>alert(1)</script>` en concepto y referencia → debe aparecer **literal** (no ejecutarse). Correcto = no vulnerabilidad.
- **E-21 Inyección SQL** → `'; DROP TABLE "PaymentRecord"; --` en concepto/referencia → debe tratarse como texto, sin error 500.
- **E-22 Aislamiento entre empresas (multi-tenant)** → si tienes acceso a otra empresa, confirma que NO puedes vincular un pago a una factura de OTRA empresa ni ver/anular pagos de otra empresa. Fuga entre empresas = CRÍTICO.
- **E-23 Adjunto inválido** → intenta subir un archivo no permitido (ej. `.exe`) o demasiado grande como comprobante → debe rechazar con mensaje claro.
- **E-24 Permisos** → si puedes, prueba con un rol de solo lectura (VIEWER): no debería poder registrar/anular pagos ni eliminar comprobantes.

---

## FASE 4 — INTEGRACIÓN

- **4.1 Facturación / CxC / CxP:** confirma que un cobro baja el saldo de la factura de venta y un lote A/P baja el de las facturas de compra; y que al anular, los saldos se restauran exactamente.
- **4.2 Contabilidad (Libro Diario / Mayor):** verifica los asientos de pago (cuando hay cuenta bancaria + GL): cuenta correcta (Banco, CxC/CxP), partida doble (Σ=0), línea de IGTF cuando aplica, diferencial cambiario en divisa. El asiento de anulación debe ser la contrapartida.
- **4.3 IGTF:** el 3% en pagos en divisa debe reflejarse tanto en el pago como en el asiento; en pagos VES de empresa no-especial NO debe haber IGTF.
- **4.4 Auditoría:** confirma que registrar (CREATE), aplicar (APPLY) y anular (VOID) pagos y lotes quedan en el log **con usuario, fecha/hora e IP/User-Agent**. (Regla #1: si la tabla no muestra IP, búscala o pregúntala — no concluyas que no se graba.)
- **4.5 Tasa de cambio:** en pagos en divisa, ¿se usa una tasa para convertir a VES? ¿El diferencial cambiario (si la factura tenía otra tasa) se asienta como ganancia/pérdida (NIC 21)?
- **4.6 Dashboard / alertas:** ¿hay algún widget de pagos pendientes o por aplicar, si aplica?

---

## FASE 5 — INFORME

```
INFORME DE AUDITORÍA OPERATIVA — MÓDULO PAGOS
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditora: Daniela Quintero, CPC 51.077

1. RESUMEN EJECUTIVO
2. RECONOCIMIENTO (Fase 0): [pestañas, métodos, prerrequisitos disponibles]
3. FUNCIONALIDADES EVALUADAS
   Flujo                       | ✅/⚠️/❌ | Observación + evidencia
   Cobro sin factura           |          |
   Cobro vinculado a factura   |          |
   PagoMóvil / Zelle / Cashea  |          |
   IGTF automático             |          |
   Comprobante + OCR           |          |
   Lote A/P: crear/aplicar/anular |       |
4. VALIDACIONES Y CONTROLES (E-1…E-24) [Prueba | Comportamiento | ¿Correcto? | Riesgo]
5. INTEGRACIÓN [Módulo | Resultado | Gap]
   Facturación / CxC / CxP     |          |
   Contabilidad (asientos)     |          |
   IGTF                        |          |
   Auditoría (usuario/IP/UA)   |          |
   Tasa de cambio / NIC 21     |          |
6. CUMPLIMIENTO IGTF / VEN-NIF / SENIAT [Norma | ✅/⚠️/❌ | detalle]
7. HALLAZGOS (solo con evidencia + severidad calibrada)
   Ref  | Descripción | Flujo | Severidad | Evidencia
8. RECOMENDACIONES (mejoras ≠ incumplimientos)
9. FALSOS POSITIVOS DESCARTADOS / VERIFICADO COMO DISEÑO CORRECTO
   [Ej.: "Pago sin factura no genera asiento — diseño correcto (imprest/cobro suelto)"]
   [Ej.: "IGTF recalculado por el servidor ignorando mi valor — control correcto"]
   [Ej.: "Pago anulado sigue en Auditoría pero no en el listado — soft-delete correcto"]
   [Ej.: "Sin asiento porque la empresa no tiene cuentas GL configuradas — degradación correcta"]
10. CONCLUSIÓN [listo / requiere ajustes / no listo]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Captura pantalla en cada paso relevante.
- **NAVEGA SIEMPRE POR EL MENÚ/SIDEBAR DE LA APP, no tecleando URLs a mano.** Si llegas a un 404 por una URL que tú escribiste, NO es hallazgo — vuelve por el menú. Solo cuenta un 404/500 al que llegues por enlaces reales de la app.
- El `companyId` correcto es el que ya aparece en la barra de direcciones; no inventes ni reutilices uno de otra pestaña.
- **Facturación, Contabilidad, Bancos, CxC/CxP NO son el módulo Pagos.** Los visitas solo como integración/prerrequisito. Un problema fuera de Pagos se anota como "fuera de alcance".
- Para ver el asiento de un pago necesitas haber seleccionado cuenta bancaria + tener cuentas GL configuradas. Sin eso, la ausencia de asiento NO es un bug (regla #4).
- Antes de reportar "no calcula IGTF" / "no mueve el saldo" / "no registra X": aplica las reglas anti-FP. Si no es verificable desde la UI, decláralo "no verificable".
- Distingue siempre: ¿es un bug, una mejora deseable, o diseño contable/fiscal correcto?
- Si encuentras saldo de factura corrupto, doble aplicación de un pago, asiento descuadrado, IGTF/monto mal calculado, o fuga entre empresas → es CRÍTICO y va primero.
- Si el rate limiter te bloquea por muchas peticiones seguidas, espera 1 minuto — es protección anti-abuso, no un bug.
