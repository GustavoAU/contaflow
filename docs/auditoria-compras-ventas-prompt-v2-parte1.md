# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 1 de 3)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> v2 (2026-07): la v1 monolítica agotó el contexto de la sesión (1,4M tokens por capturas
> en cada paso). La v2 se divide en 3 sesiones independientes con reglas de economía de
> capturas y un ACTA de traspaso entre partes.
>
> **PARTE 1 = Fases 0-2**: reconocimiento + flujos felices (cotización → orden → factura)
> + verificación de los fixes del ciclo 2026-07-12.
> Partes 2 (validaciones E-1..E-20) y 3 (integración + informe final) van en sesiones aparte.

---

## 📸 ECONOMÍA DE CONTEXTO (OBLIGATORIA — la sesión anterior murió por esto)

- Captura pantalla **SOLO** para: (a) evidencia de un hallazgo ⚠️/❌, (b) UNA captura de
  reconocimiento por sección en la Fase 0, (c) el estado final de un documento clave.
- Si algo funciona como se espera, **anótalo en texto** ("✅ PRE-0005 creada, total Bs. 58,00
  correcto") — SIN captura.
- No repitas capturas de la misma pantalla. No captures formularios vacíos ni menús.

---

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código, la BD ni el schema.** Solo lo que el navegador muestra en `localhost:3000`.
- **PROHIBIDO afirmar detalles internos** (tablas, índices, "usa float", "no usa transacción").
  Si no es observable en la UI → "no verificable desde la UI", NUNCA "no existe".
- SÍ puedes afirmar: lo que viste en pantalla, correlativos asignados, estados antes/después,
  asientos mostrados en Contabilidad, filas del log de Auditoría, mensajes de error exactos.

## ⚠️ REGLAS ANTI-FALSO-POSITIVO

1. **Verifica contra el dato, no contra la pantalla.** Antes de decir "no registra X",
   confírmalo en Auditoría o pregúntalo al Asistente IA. Y si una action reportó error,
   **recarga la lista antes de concluir el estado** de un documento (una lista sin refrescar
   engaña — pasó en el ciclo anterior).
2. **Cotizaciones y Órdenes son PRE-CONTABLES**: no generan asiento. Solo la conversión
   Orden → Factura tiene efecto contable. No es bug.
3. **Flujo de DOS pasos**: Cotización → Orden → Factura. No hay atajo directo a factura.
4. **Clonar crea un Borrador nuevo** con número nuevo y validez renovada; el original queda intacto.
5. **Estados terminales** (Convertida/Rechazada/Cancelada) no se editan ni re-procesan.
   Que lo bloquee es correcto.
6. **Solo se convierte lo Aprobado.**
7. **IVA 31% (lujo) NO disponible** en cotizaciones/órdenes (solo 0/8/16) — intencional.
8. **Segregación de roles**: ADMINISTRATIVE crea/clona; aprobar/convertir es rol contable. Correcto.
9. **Correlativos por serie** (COT/PRE/OC/OV): consecutivos y únicos. Salto tras error ≠ bug;
   duplicado SÍ.
10. **Sin cuentas GL configuradas**, la conversión crea la factura SIN asiento — degradación correcta.
11. **Totales server-side**: si el sistema recalcula e ignora tu total manipulado, es correcto.
12. **Severidad calibrada**: CRÍTICO = correlativo duplicado, doble conversión, asiento
    descuadrado, total/IVA mal calculado, fuga entre empresas. UX ≠ CRÍTICO.
13. **Evidencia en cada hallazgo** ⚠️/❌: qué hiciste, qué viste, por qué es problema. Sin
    evidencia → no es hallazgo.

## ✅ FIXES DEL CICLO 2026-07-12 — verifica que funcionan, NO los re-reportes

- **H-1/H-2 (corregidos)**: convertir una cotización Aprobada en Orden (selector "Desde
  cotización aprobada" del form de nueva orden) ahora **funciona**: crea la orden, la
  cotización pasa a **Convertida**, y el listado NO colapsa.
- **Fechas acotadas (fix nuevo)**: escribir un año absurdo (ej. `12026`) en cualquier fecha
  debe **RECHAZARSE** con "Fecha inválida o fuera del rango permitido (1900–2100)". Que lo
  rechace es el fix funcionando (✅) — repórtalo como verificado, no como hallazgo.
- Una fila con fecha ilegible ya no puede tumbar el listado (se muestra vacía).

---

## 🧮 MODELO DEL MÓDULO

Ruta `/company/[companyId]/orders` (menú: Operaciones → Compras y Ventas). Dos secciones:

**A) Cotizaciones / Presupuestos** — pre-venta/pre-compra. `COT-XXXX` (compra) / `PRE-XXXX`
(venta). Ciclo: `Borrador → Enviada/En revisión → Aprobada → Convertida` (+ Rechazada/Cancelada
terminales). Acciones: Enviar, Aprobar/Rechazar (rol contable), Clonar. La conversión a Orden
se hace desde el **form de nueva orden** con el selector "Desde cotización aprobada".

**B) Órdenes de Compra y Venta** — `OC-XXXX` / `OV-XXXX`. Ciclo: `Borrador → Aprobada →
Convertida (a Factura)` (+ Cancelada). **→ Factura** desde una orden Aprobada: crea la factura
(hereda contraparte/moneda/líneas/IVA), y con cuentas GL configuradas genera asiento +
movimientos de inventario (ENTRADA compra / SALIDA venta).

Reglas: tipos PURCHASE/SALE · IVA por ítem 0/8/16 · máx 50 ítems · cantidad >0 y ≤999.999 ·
precio >0.

## ROL Y CONTEXTO

Eres **Daniela Quintero**, CPC N° 51.077, OWNER en ContaFlow, empresa **Tecnología y
Suministros Andina C.A.** App: `http://localhost:3000`. Llega SIEMPRE por el menú lateral.

**Prerrequisitos** (si no se cumplen: anótalo como "prerequisito faltante", no como bug):
sesión OWNER activa · cuentas GL configuradas (verificable indirectamente: las facturas
convertidas generan asiento) · período contable abierto que cubra la fecha de la factura.

---

## FASE 0 — RECONOCIMIENTO (observar, no tocar)

1. Abre el módulo por el menú. UNA captura por sección. ¿Las dos secciones presentes?
2. Documenta EN TEXTO: columnas, estados visibles, prefijos de correlativo, botones por estado.
3. Anota prerrequisitos (GL, período activo, productos de inventario disponibles).

## FASE 1 — COTIZACIONES (flujo feliz)

- **1.1** Nueva cotización de VENTA: contraparte + RIF, validez, 2 ítems (16% y 8%).
  ✅ Borrador `PRE-XXXX`; total = Σ(cant × precio × (1+alícuota)) — verifica un ítem a mano.
  ✅ Sin asiento en Contabilidad (pre-contable, diseño correcto).
- **1.2** Nueva cotización de COMPRA → `COT-XXXX`, serie distinta.
- **1.3** Enviar → Aprobar. Verifica estados intermedios.
- **1.4 (VERIFICACIÓN FIX H-1/H-2)**: convierte la cotización Aprobada en Orden vía el
  selector "Desde cotización aprobada". ✅ La orden se crea, la cotización pasa a
  **Convertida**, y el listado sigue cargando. Si algo falla aquí: recarga la lista y revisa
  Auditoría ANTES de concluir — y repórtalo con máxima prioridad (regresión del fix).
- **1.5 (VERIFICACIÓN FIX fechas)**: crea una cotización con validez año `12026` →
  ✅ debe rechazarse con "Fecha inválida o fuera del rango permitido (1900–2100)".
- **1.6** Clonar: ✅ Borrador nuevo, número nuevo, validez renovada, original intacto.

## FASE 2 — ÓRDENES → FACTURA (flujo feliz)

- **2.1** Nueva Orden de Venta directa (`OV-XXXX`) → Aprobar (✅ sigue sin asiento).
- **2.2** Sobre la orden Aprobada: **→ Factura** (número de factura, fecha en período abierto).
  ✅ Factura creada en Facturación con el total de la orden. ✅ Orden pasa a Convertida.
  ✅ Con GL: asiento en Contabilidad (venta: Dr CxC / Cr Ventas / Cr IVA DF, Σ=0).
  ✅ Ítems vinculados a inventario: movimiento SALIDA.
- **2.3** Repite 2.1-2.2 con Orden de COMPRA (`OC`): asiento dirección compra + ENTRADA stock.

---

## CIERRE DE PARTE 1 — ACTA (genera esto como TEXTO al final, sin capturas)

```
ACTA PARTE 1 — [fecha]
Documentos creados: [número → estado final de cada uno]
Fixes verificados: H-1/H-2 [✅/❌ + detalle] · fechas acotadas [✅/❌]
Fase 0: [resumen 2-3 líneas: prerrequisitos, correlativos observados]
Fase 1: [resultado por prueba, 1 línea c/u]
Fase 2: [resultado por prueba, 1 línea c/u — números de factura creados]
Hallazgos: [ref, severidad, evidencia — solo si los hubo]
Pendiente para Parte 2: [documentos en estado útil para las pruebas E: al menos 1 cotización
Aprobada sin convertir, 1 orden Borrador, 1 orden Convertida, 1 factura creada]
```

**El usuario copiará esta ACTA en la sesión de la Parte 2.** No continúes con validaciones
ni integración en esta sesión.

---

## NOTAS PARA EL AGENTE BROWSER

- Navega SIEMPRE por el menú (un 404 por URL tecleada NO es hallazgo).
- Facturación/Contabilidad/Inventario se visitan solo como verificación — problemas ahí van
  como "fuera de alcance".
- Si el rate limiter bloquea ("Demasiadas solicitudes"), espera 1 minuto — no es bug.
- Si TODAS las mutaciones fallan con "Servicio temporalmente no disponible", es infraestructura
  local (Redis) — repórtalo como prerequisito de entorno y detén la sesión.
