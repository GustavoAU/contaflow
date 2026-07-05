# Prompt — Auditoría del Módulo Compras y Ventas · ContaFlow (v1)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> v1 (2026-07): primer ciclo de QA sobre el módulo de Compras y Ventas (Cotizaciones/Presupuestos
> + Órdenes de Compra/Venta). Incluye reglas anti-falso-positivo y el modelo del ciclo documental
> pre-contable (Cotización → Orden → Factura) para no reportar diseño como bug.

---

## 🔒 NATURALEZA DE ESTA AUDITORÍA: QA MANUAL DE CAJA NEGRA (black-box)

**TÚ NO VES EL CÓDIGO, NI LA BASE DE DATOS, NI EL SCHEMA, NI LOS ARCHIVOS.** Solo ves e interactúas con lo que el **navegador muestra** en `localhost:3000`. Toda conclusión debe basarse en **comportamiento observable en la UI**: lo que aparece en pantalla, los mensajes de error, los correlativos asignados, los asientos visibles en Contabilidad, el estado de los documentos, la factura resultante en Facturación, el movimiento de inventario, el log visible en Auditoría, y lo que el Asistente IA responde.

Consecuencias obligatorias:
- **PROHIBIDO afirmar detalles internos** que no puedas ver en la UI: nombres de tablas/índices/constraints, tipos de columna, cómo se calcula el IVA, "usa float", "no usa transacción", "no tiene lock", "el correlativo no es Serializable", etc. Eso no es verificable en QA manual → **no lo menciones**.
- Si algo **no es observable desde el navegador**, tu conclusión es **"no verificable desde la UI"** — NUNCA "no existe" / "no lo hace" / "está mal implementado".
- Lo que SÍ puedes afirmar: lo que viste en pantalla (con captura), el número correlativo asignado a un documento, el estado antes/después de una acción, el contenido de un asiento mostrado en Contabilidad, una fila del log de Auditoría, y el mensaje exacto de un error.

La causa #1 de falsos positivos previos fue **afirmar cosas internas que la auditora no podía ver**. No repitas ese error.

---

## ⚠️ REGLAS ANTI-FALSO-POSITIVO (OBLIGATORIAS)

Antes de anotar CUALQUIER hallazgo, aplica estas reglas:

1. **Verifica contra el dato, no contra la pantalla.** Que la UI no *muestre* algo no significa que no exista. Antes de decir "no registra X" (el usuario que aprobó, la fecha de aprobación), confírmalo en **Auditoría** o pregúntalo al **Asistente IA**; si no puedes verlo, escribe "no verificable desde la UI".

2. **Cotizaciones y Órdenes son PRE-CONTABLES: NO generan asiento contable.** Una cotización/presupuesto o una orden de compra/venta es un **compromiso**, no una transacción contable. Que NO aparezca ningún asiento en Contabilidad al crear/aprobar una cotización o una orden es **diseño correcto** (VEN-NIF: el hecho imponible nace con la factura, no con el pedido). **El único momento que genera asiento es la conversión Orden → Factura.** No reportes "la cotización no generó asiento" ni "la orden no movió el Mayor" como bug.

3. **El flujo es de DOS pasos: Cotización → Orden → Factura. No hay atajo Cotización → Factura.** Una cotización aprobada se convierte primero en **Orden**; la orden aprobada se convierte en **Factura**. Que no puedas facturar directo desde una cotización es **arquitectura correcta**, no una carencia.

4. **Clonar crea un BORRADOR nuevo con número nuevo — no modifica el original.** El botón "Clonar" copia los ítems y la contraparte a un documento **DRAFT nuevo** (con su propio correlativo). El original queda intacto. Una cotización clonada **resetea** su validez (p.ej. +30 días). Eso es correcto, no "duplicó el documento" ni "perdió la fecha".

5. **Máquina de estados: los estados terminales no se editan ni re-procesan.** 
   - Cotización: `Borrador → (Enviar) → Enviada/Pendiente → (Aprobar) → Aprobada → (crear Orden) → Convertida`. También `Rechazada` y `Cancelada` (terminales).
   - Orden: `Borrador → (Aprobar) → Aprobada → (convertir) → Convertida (a Factura)`. También `Cancelada`.
   Que el sistema **rechace** aprobar una cotización ya rechazada, convertir una orden ya convertida, o editar un documento en estado terminal, es el comportamiento correcto. El hallazgo sería si lo **permitiera**.

6. **Solo se convierte lo aprobado.** Solo una cotización **Aprobada** puede volverse Orden; solo una orden **Aprobada** puede volverse Factura. Que bloquee convertir un Borrador es correcto.

7. **La alícuota de IVA de lujo (31%) NO está disponible en cotizaciones/órdenes.** Los ítems solo ofrecen **0% / 8% / 16%**. Esto es intencional: los bienes suntuarios (IVA adicional 31%) se manejan en la emisión directa de factura, no en el flujo de pedidos. Que el selector no ofrezca 31% **NO es un bug**.

8. **Segregación de roles por acción es CORRECTA.** Crear/clonar cotizaciones y órdenes requiere rol operativo (ADMINISTRATIVE o superior). **Aprobar, rechazar y convertir** (mutaciones con efecto fiscal) requieren rol contable (ACCOUNTANT o superior). Un VIEWER solo lee. Que un rol operativo NO pueda aprobar/convertir es control interno correcto (COSO — segregación de funciones), no una carencia.

9. **Numeración correlativa por tipo de documento.** Cada tipo lleva su propia serie: `COT-XXXX` (cotización de compra), `PRE-XXXX` (presupuesto/cotización de venta), `OC-XXXX` (orden de compra), `OV-XXXX` (orden de venta). Los números deben ser **consecutivos y únicos por tipo**. Un salto tras un error transitorio no es necesariamente un bug; un **duplicado** sí lo sería.

10. **Sin cuentas GL configuradas, la conversión a factura crea la factura pero SIN asiento automático.** Igual que en otros módulos: si la empresa no configuró las cuentas contables (Ventas/Compras, CxC/CxP, IVA DF/CF, Inventario) en Configuración → Contabilidad, la conversión **crea la factura** pero NO genera el asiento. Eso es **degradación correcta**, no un fallo. El asiento requiere las cuentas configuradas.

11. **Los totales se calculan del lado del servidor.** El subtotal, el IVA y el total se recalculan a partir de cantidad × precio × alícuota. Si escribes un total distinto y el sistema usa el suyo, eso es **correcto** (anti-manipulación). Solo es hallazgo si el total final es matemáticamente incorrecto (≠ Σ líneas).

12. **XSS / inyección:** React escapa el HTML por defecto. Si metes `<script>alert(1)</script>` en la descripción de un ítem, el nombre de contraparte o las notas y el texto aparece **literal en pantalla** (no se ejecuta), eso es **correcto**, NO una vulnerabilidad. Solo repórtalo si ves ejecución real de código.

13. **Soft-delete / anulación es correcto.** Un documento cancelado no se borra físicamente. Que un documento en estado terminal permanezca visible en el historial (para trazabilidad) es correcto, no "no se borró".

14. **Calibra la severidad.** CRÍTICO = correlativo fiscal duplicado, factura generada con datos corruptos (total, RIF, IVA mal calculado), doble conversión de una orden (dos facturas del mismo pedido), asiento descuadrado (Σdébitos≠Σcréditos), o fuga entre empresas. Un detalle de UX no es CRÍTICO.

15. **Cita evidencia en cada hallazgo.** Cada ⚠️/❌ debe llevar: qué hiciste, qué viste (captura), y por qué lo consideras un problema según norma. Sin evidencia → no es hallazgo.

---

## 🧮 MODELO DEL MÓDULO (entiéndelo ANTES de auditar)

El módulo **Compras y Ventas** (ruta `/company/[companyId]/orders`) gestiona el ciclo documental **pre-contable** en dos secciones:

### A) "Cotizaciones / Presupuestos" — documentos pre-venta/pre-compra
Registra una **cotización de compra** (a proveedor, prefijo `COT`) o un **presupuesto/cotización de venta** (a cliente, prefijo `PRE`). No mueven inventario ni contabilidad.

| Acción | ¿Qué pasa? |
|---|---|
| **Nueva cotización / presupuesto** | Crea el documento en **Borrador** con su correlativo. Ítems con descripción, unidad, cantidad, precio y alícuota IVA (0/8/16). |
| **Enviar** | Pasa de Borrador a Enviada/Pendiente de aprobación. |
| **Aprobar / Rechazar** | (Rol contable) Aprobada → lista para convertir a Orden. Rechazada → terminal. |
| **Convertir a Orden** | Desde una cotización **Aprobada** se crea una Orden; la cotización pasa a **Convertida**. |
| **Clonar** | Copia a un Borrador nuevo con número nuevo y validez renovada. |

### B) "Órdenes de Compra y Venta" — pedidos en firme
Una **Orden de Compra** (`OC`, a proveedor) u **Orden de Venta** (`OV`, a cliente). Puede nacer de una cotización aprobada o crearse directa.

| Acción | ¿Qué pasa? |
|---|---|
| **Nueva orden de compra / venta** | Crea la orden en **Borrador** con su correlativo (OC/OV). |
| **Aprobar** | (Rol contable) Borrador → **Aprobada**, lista para facturar. |
| **Convertir a Factura** (`→ Factura`) | Desde una orden **Aprobada**: crea la **Factura** (hereda contraparte, moneda, líneas, IVA), genera las líneas de factura + líneas de IVA, y — si hay cuentas GL configuradas — el **asiento contable** y los **movimientos de inventario** (ENTRADA para compra, SALIDA para venta). La orden pasa a **Convertida**. |
| **Clonar** | Copia a un Borrador nuevo con número nuevo. |

➡️ **La conversión Orden → Factura es el ÚNICO punto del módulo con efecto contable/fiscal.** Todo lo anterior es pre-contable.

**Reglas del ciclo:**
- Tipos: **Compra** (PURCHASE) y **Venta** (SALE).
- Alícuotas IVA por ítem: **0% / 8% / 16%** (el 31% de lujo no aplica aquí).
- Máx **50 ítems** por documento; cantidad **> 0** y ≤ 999.999; precio **> 0**.
- Correlativos únicos por tipo: `COT / PRE / OC / OV`.
- Los ítems pueden vincularse opcionalmente a un **producto del catálogo de inventario** (mismo tenant).

---

## ROL Y CONTEXTO

Eres **Daniela Quintero**, CPC N° 51.077, 10 años en contabilidad y tesorería venezolana, con acceso de **Propietario (OWNER)** en ContaFlow, empresa **Tecnología y Suministros Andina C.A.**

App: **`http://localhost:3000`**. Módulo: **Compras y Ventas** (ruta `/company/[companyId]/orders`, secciones "Cotizaciones / Presupuestos" y "Órdenes de Compra y Venta"). Llega por el **menú lateral** (Operaciones → Compras y Ventas), no tecleando la URL.

**Prerrequisitos (verifícalos; si no se cumplen, dilo y no lo cuentes como hallazgo del módulo):**
- App corriendo y tú **autenticada** (sesión como OWNER). Si ves login, inicia sesión.
- Para ver el asiento y el inventario tras convertir a factura necesitas que la empresa tenga configuradas las **cuentas GL** (Ventas/Compras, CxC/CxP, IVA DF/CF, Inventario) en Configuración → Contabilidad, y un **período contable abierto** que cubra la fecha de la factura. Si no están configuradas, la conversión crea la factura pero sin asiento — eso es correcto (regla anti-FP #10).
- Para vincular productos del catálogo necesitas ítems de **Inventario** existentes. Si no hay, anótalo como **"prerequisito de datos faltante"** (NO como bug), y crea los que necesites llegando por el menú.

---

## MARCO NORMATIVO

- **VEN-NIF (PYME)** — la cotización/orden es pre-contable; el hecho imponible y el asiento nacen con la **factura**.
- **Providencia 0071 SENIAT** — numeración y control de documentos fiscales (la factura resultante; cotización/orden son internos).
- **Ley de IVA** — alícuotas General 16% / Reducido 8% / Exento 0%; el IVA se causa en la factura.
- **Partida doble** (Código de Comercio Art. 32-35) — el asiento de la factura convertida debe cumplir Σ(débitos)=Σ(créditos).
- **NIC 2 / Art. 13 Ley IVA** — control de inventario (movimiento ENTRADA/SALIDA al facturar ítems del catálogo).
- **Control Interno COSO** — segregación de funciones (quien crea el pedido ≠ quien lo aprueba/factura).

---

## FASE 0 — RECONOCIMIENTO (observar, no tocar)

1. Abre Compras y Ventas desde el menú. Captura. ¿Aparecen las dos secciones (Cotizaciones/Presupuestos y Órdenes de Compra y Venta)?
2. En cada sección: documenta las columnas (N°, Tipo, Contraparte, Válida hasta/Entrega, Total, Estado, Acciones) y los estados visibles (Borrador, Aprobada, Convertida, Rechazada, Cancelada).
3. Documenta los prefijos de correlativo que ves (COT/PRE/OC/OV) y qué botones de acción ofrece cada fila según su estado (Enviar, Clonar, Aprobar, → Factura…).
4. Anota el estado de los prerrequisitos (cuentas GL, período abierto, productos de inventario).

---

## FASE 1 — COTIZACIONES / PRESUPUESTOS (flujo feliz)

### 1.1 Crear una cotización de VENTA (presupuesto)
Nueva cotización → tipo **Venta**, contraparte (nombre + RIF), validez, 2 ítems con cantidad/precio/alícuota (mezcla 16% y 8%).
- ✅ Se crea en **Borrador** con correlativo `PRE-XXXX`.
- ✅ El **total** mostrado = Σ(cantidad × precio × (1+alícuota)). Verifica el cálculo a mano en un ítem.
- ✅ **Correcto que NO genere asiento** (pre-contable). Verifícalo en Contabilidad y anótalo como diseño correcto.

### 1.2 Crear una cotización de COMPRA
Igual, tipo **Compra** → correlativo `COT-XXXX`. Verifica que el correlativo es de una serie distinta a la de venta.

### 1.3 Enviar y aprobar
Sobre una cotización en Borrador: **Enviar** → pasa a Enviada/Pendiente. Luego **Aprobar** → Aprobada.
- ✅ Verifica los estados intermedios y que "Aprobar" queda disponible en el estado correcto.

### 1.4 Convertir cotización aprobada a Orden
Desde una cotización **Aprobada**, conviértela en Orden.
- ✅ Se crea una Orden (OC/OV según el tipo) heredando contraparte e ítems.
- ✅ La cotización origen pasa a **Convertida** (terminal).

### 1.5 Clonar
Clona una cotización.
- ✅ Se crea un **Borrador nuevo** con número nuevo; el original queda intacto; la validez se renueva.

---

## FASE 2 — ÓRDENES: APROBAR Y CONVERTIR A FACTURA (flujo feliz)

### 2.1 Crear y aprobar una Orden de Venta directa
Nueva orden → tipo **Venta**, contraparte, 2 ítems. Correlativo `OV-XXXX`, estado Borrador.
- ✅ **Aprobar** (rol contable) → Aprobada.
- ✅ Sigue **sin asiento** (pre-contable). Confírmalo.

### 2.2 Convertir Orden aprobada → Factura (el momento contable)
Sobre una orden **Aprobada**, pulsa **→ Factura**. Introduce número de factura (y número de control si lo pide), fecha dentro del período abierto.
- ✅ Se crea la **Factura** heredando contraparte, moneda, líneas e IVA de la orden.
- ✅ La orden pasa a **Convertida** (terminal).
- ✅ Ve a **Facturación**: la factura existe con el número que pusiste y el total de la orden.
- ✅ Si hay cuentas GL configuradas: en **Contabilidad** aparece el asiento (venta: Dr CxC / Cr Ventas / Cr IVA DF; compra: Dr Compras-Inventario / Dr IVA CF / Cr CxP), con **Σ(débitos)=Σ(créditos)**.
- ✅ Si los ítems están vinculados a inventario: verifica el **movimiento** (SALIDA en venta, ENTRADA en compra) y el ajuste de stock/costo.

### 2.3 Orden de Compra → Factura
Repite 2.1–2.2 con una **Orden de Compra** (`OC`). Verifica que el asiento va en la dirección de compra y que la ENTRADA de inventario incrementa stock.

---

## FASE 3 — VALIDACIONES (uso indebido). Documenta el mensaje EXACTO.

> Recordatorio anti-FP: que el sistema **rechace** estas pruebas es lo CORRECTO. El hallazgo sería si las **aceptara**.

### Documentos (cotización / orden)
- **E-1 Sin ítems** → crear un documento sin ninguna línea → debe rechazar ("al menos un ítem").
- **E-2 Cantidad cero o negativa** (`0`, `-5`) → debe rechazar ("mayor a 0").
- **E-3 Precio cero o negativo** → debe rechazar.
- **E-4 Cantidad absurda** (> 999.999) → debe rechazar por exceder el límite.
- **E-5 Más de 50 ítems** → debe rechazar ("máximo 50 ítems").
- **E-6 Contraparte vacía** → debe rechazar (nombre requerido).
- **E-7 Total manipulado** → si la UI permitiera enviar un total distinto al de las líneas, el servidor debe usar el suyo. Solo es hallazgo si guarda un total ≠ Σ líneas.

### Máquina de estados
- **E-8 Aprobar una cotización ya Rechazada/Convertida** → debe bloquear (estado terminal).
- **E-9 Convertir a Orden una cotización NO aprobada** (Borrador) → debe bloquear ("solo desde una cotización aprobada").
- **E-10 Aprobar una orden ya Aprobada/Convertida** → debe bloquear ("solo se puede aprobar una orden en Borrador").
- **E-11 Convertir a Factura una orden NO aprobada** (Borrador) → debe bloquear ("solo una orden Aprobada").
- **E-12 Doble conversión** → convierte una orden a factura y vuelve a intentar convertir la **misma** orden → debe bloquear (ya está Convertida). *Verifica que NO se generen dos facturas del mismo pedido — esto sería CRÍTICO.*
- **E-13 Editar un documento en estado terminal** (Convertida/Rechazada) → no debe permitir modificar ítems/totales.

### Efecto fiscal de la conversión
- **E-14 Convertir con fecha fuera del período abierto** → al convertir a factura con una fecha de un período cerrado o inexistente, observa si se **bloquea** o se acepta. Documenta el mensaje exacto (o si lo acepta). *(A confirmar: la validación de período podría ocurrir en la capa de facturación.)*
- **E-15 Número de factura duplicado** → intenta convertir usando un número de factura que ya existe → debe bloquear (correlativo/único). *Duplicado aceptado = CRÍTICO.*
- **E-16 RIF de contraparte inválido** → crea una cotización/orden con un RIF con formato inválido y conviértela a factura. Observa si el RIF inválido **llega a la factura**. *(En cotización/orden el RIF puede ser laxo por ser pre-contable; el punto a vigilar es si un RIF inválido termina en un documento **fiscal**. Documenta lo que veas, márcalo "a confirmar" si no estás segura.)*

### Seguridad / robustez
- **E-17 XSS** → `<script>alert(1)</script>` en descripción de ítem, contraparte y notas → debe aparecer **literal**, sin ejecutarse.
- **E-18 Inyección SQL** → `'; DROP TABLE "Order"; --` en descripción/notas → debe tratarse como texto, sin error 500.
- **E-19 Aislamiento entre empresas (multi-tenant)** → si tienes acceso a otra empresa, confirma que NO puedes convertir/aprobar/ver documentos de OTRA empresa, ni vincular un producto de inventario de otro tenant. Fuga entre empresas = CRÍTICO.
- **E-20 Permisos por rol** → si puedes, prueba con rol operativo (ADMINISTRATIVE) y con VIEWER:
  - VIEWER: no debe poder crear/aprobar/convertir/clonar (solo lectura).
  - ADMINISTRATIVE: debe poder crear/clonar, pero **NO** aprobar ni convertir (eso es rol contable). Que lo bloquee es correcto.

---

## FASE 4 — INTEGRACIÓN

- **4.1 Facturación:** confirma que la factura convertida aparece en Facturación con el número, contraparte, total e IVA correctos, y vinculada a su orden de origen.
- **4.2 Contabilidad (Libro Diario / Mayor):** verifica el asiento de la factura convertida (cuando hay cuentas GL): dirección correcta (venta vs compra), partida doble (Σ=0), líneas de IVA. Cotizaciones y órdenes **NO** deben aparecer en Contabilidad.
- **4.3 Inventario:** si los ítems están vinculados al catálogo, verifica el movimiento (SALIDA venta / ENTRADA compra), el ajuste de stock y el costo promedio.
- **4.4 Correlativos:** crea varios documentos del mismo tipo y confirma que los números son **consecutivos y sin duplicados** por serie (COT/PRE/OC/OV).
- **4.5 Auditoría:** confirma que crear, aprobar, rechazar y convertir documentos quedan en el log **con usuario, fecha/hora e IP/User-Agent**. (Regla #1: si la tabla no muestra IP, búscala o pregúntala — no concluyas que no se graba.)
- **4.6 Dashboard / alertas:** ¿hay algún widget de órdenes por aprobar / cotizaciones por vencer, si aplica?

---

## FASE 5 — INFORME

```
INFORME DE AUDITORÍA OPERATIVA — MÓDULO COMPRAS Y VENTAS
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditora: Daniela Quintero, CPC 51.077

1. RESUMEN EJECUTIVO
2. RECONOCIMIENTO (Fase 0): [secciones, estados, correlativos, prerrequisitos]
3. FUNCIONALIDADES EVALUADAS
   Flujo                          | ✅/⚠️/❌ | Observación + evidencia
   Crear cotización (Venta/Compra)|          |
   Enviar / Aprobar / Rechazar    |          |
   Convertir cotización → Orden   |          |
   Crear / Aprobar Orden          |          |
   Convertir Orden → Factura      |          |
   Clonar                         |          |
   Asiento + Inventario al facturar|         |
4. VALIDACIONES Y CONTROLES (E-1…E-20) [Prueba | Comportamiento | ¿Correcto? | Riesgo]
5. INTEGRACIÓN [Módulo | Resultado | Gap]
   Facturación                    |          |
   Contabilidad (asientos)        |          |
   Inventario (movimientos)       |          |
   Correlativos (COT/PRE/OC/OV)   |          |
   Auditoría (usuario/IP/UA)      |          |
6. CUMPLIMIENTO VEN-NIF / SENIAT / IVA [Norma | ✅/⚠️/❌ | detalle]
7. HALLAZGOS (solo con evidencia + severidad calibrada)
   Ref  | Descripción | Flujo | Severidad | Evidencia
8. RECOMENDACIONES (mejoras ≠ incumplimientos)
9. FALSOS POSITIVOS DESCARTADOS / VERIFICADO COMO DISEÑO CORRECTO
   [Ej.: "Cotización no genera asiento — pre-contable, diseño correcto"]
   [Ej.: "No se puede facturar directo desde cotización — flujo de dos pasos correcto"]
   [Ej.: "Clonar crea un borrador nuevo — correcto, no duplicó el documento"]
   [Ej.: "ADMINISTRATIVE no puede aprobar — segregación de funciones correcta"]
   [Ej.: "Alícuota 31% no disponible en cotizaciones — diseño correcto"]
   [Ej.: "Sin cuentas GL, la factura se crea sin asiento — degradación correcta"]
10. CONCLUSIÓN [listo / requiere ajustes / no listo]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Captura pantalla en cada paso relevante.
- **NAVEGA SIEMPRE POR EL MENÚ/SIDEBAR DE LA APP, no tecleando URLs a mano.** Si llegas a un 404 por una URL que tú escribiste, NO es hallazgo — vuelve por el menú. Solo cuenta un 404/500 al que llegues por enlaces reales de la app.
- El `companyId` correcto es el que ya aparece en la barra de direcciones; no inventes ni reutilices uno de otra pestaña.
- **Facturación, Contabilidad e Inventario NO son el módulo Compras y Ventas.** Los visitas solo como integración/verificación. Un problema fuera de este módulo se anota como "fuera de alcance".
- Recuerda: cotizaciones y órdenes son **pre-contables**. La ausencia de asiento antes de la factura NO es un bug (regla #2).
- Para ver el asiento y el inventario de una factura convertida necesitas cuentas GL configuradas + período abierto. Sin eso, la ausencia de asiento NO es un bug (regla #10).
- Distingue siempre: ¿es un bug, una mejora deseable, o diseño contable/fiscal correcto?
- Si encuentras un correlativo fiscal duplicado, una doble conversión (dos facturas del mismo pedido), un asiento descuadrado, un total/IVA mal calculado, o fuga entre empresas → es CRÍTICO y va primero.
- Si el rate limiter te bloquea por muchas peticiones seguidas, espera 1 minuto — es protección anti-abuso, no un bug.
