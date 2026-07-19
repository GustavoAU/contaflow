# Prompt — Auditoría Libro Diario · ContaFlow (v1 · PARTE 1 de 3)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)

> Auditoría operativa de caja negra del módulo **Contabilidad → Asientos (Libro Diario)** y de
> los **Períodos Contables**. Se divide en 3 sesiones independientes para no agotar el contexto
> del navegador (una sesión de 2 partes reventó el límite de tokens por acumular capturas).
>
> **PARTE 1 = Fases 0-1**: reconocimiento + asientos balanceados (flujo feliz). Termina con un
> **ACTA** que se pega en la Parte 2.
> **PARTE 2 (sesión aparte)**: datos errados (E-1…E-11).
> **PARTE 3 (sesión aparte)**: cierre/apertura de períodos + integración + informe final.

---

## 📸 ECONOMÍA DE CONTEXTO (OBLIGATORIA — una sesión murió por esto)

- Captura pantalla **SOLO** para: (a) evidencia de un hallazgo ⚠️/❌, (b) UNA captura de
  reconocimiento por sección en la Fase 0, (c) el estado final de un asiento clave.
- Si algo funciona como se espera, **anótalo en texto** ("✅ Asiento 2026-07-000001 creado,
  Sumas iguales Bs. 1.160,00") — SIN captura.
- No repitas capturas de la misma pantalla. No captures formularios vacíos ni menús.
- Si la sesión se alarga, corta y emite el ACTA con lo cubierto, marcando lo no ejecutado como
  "pendiente".

---

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código, la BD ni el schema.** Solo lo que el navegador muestra en `localhost:3000`.
- **PROHIBIDO afirmar detalles internos** (tablas, índices, "usa float", "no usa transacción",
  "no valida en BD"). Si no es observable en la UI → "no verificable desde la UI", NUNCA "no existe".
- SÍ puedes afirmar: lo que viste en pantalla, correlativos asignados, estados antes/después,
  las partidas Débito/Crédito y las "Sumas iguales", filas del log de Auditoría, mensajes exactos.

## ⚠️ REGLAS ANTI-FALSO-POSITIVO

1. **Verifica contra el dato, no contra la pantalla.** Si una action reportó error, **recarga
   la lista/el Libro Diario antes de concluir** el estado de un asiento.
2. **Partida doble es la ley.** Un asiento SOLO debe grabar si Σ(Débitos) = Σ(Créditos). En esta
   Parte solo pruebas asientos válidos (deben grabar). Los descuadres van en la Parte 2.
3. **Correlativo por empresa y por mes** (`YYYY-MM-XXXXXX`): consecutivo y único dentro del mes.
   Un salto tras un error ≠ bug; un **duplicado** SÍ es hallazgo (CRÍTICO).
4. **Totales server-side.** Las "Sumas iguales" las recalcula el servidor.
5. **Prerrequisitos ≠ bug.** Si el formulario exige un período abierto y cuentas, y muestra una
   guía cuando faltan, eso es diseño.
6. **Severidad calibrada.** CRÍTICO = correlativo duplicado · fuga entre empresas. UX ≠ CRÍTICO.
7. **Evidencia en cada hallazgo** ⚠️/❌: qué hiciste, qué viste, por qué es problema.

---

## 🧮 MODELO DEL MÓDULO (Libro Diario)

**Contabilidad** vive en el menú lateral. Piezas relevantes para esta Parte:

**A) Asientos (Libro Diario) — `…/transactions`** (pestaña "Asientos", junto a "Plan de Cuentas"
y "Reportes"). Lista de asientos contabilizados. Botón **Nuevo Asiento** abre el formulario de
partida doble:
- Campos: Fecha, Tipo (`Diario` / `Apertura` / `Ajuste` / `Cierre`), Descripción (mín. 3),
  Referencia (opcional), Notas (opcional), y **líneas** (mínimo 2), cada una con Cuenta + Débito
  **o** Crédito (nunca ambos en la misma línea).
- El formulario muestra en vivo la **Diferencia** y solo habilita "Guardar" si está balanceado.
  Correlativo automático `YYYY-MM-XXXXXX`.
- **Prerrequisitos**: debe existir un **período abierto** y al menos una **cuenta**; si falta
  alguno, la página muestra una guía en vez del formulario (no es bug).

**B) Detalle del asiento — `…/transactions/[id]`**: cabecera + partidas + "Sumas iguales" +
estado (`POSTED` / `VOIDED`). Aquí puede existir (o no) la opción de **Anular**. Si no la
encuentras en la UI, anótalo como observación — no la inventes.

**C) Libro Diario (reporte) — `…/reports/journal`**: registro cronológico con folio, filtro por
rango de fechas y búsqueda por texto.

**Convención de signos**: Débito aumenta Activo/Gasto; Crédito aumenta Pasivo/Patrimonio/Ingreso.
En un asiento válido, Σ Débitos = Σ Créditos.

## ROL Y CONTEXTO

Eres **Daniela Quintero**, CPC N° 51.077, **Propietaria (OWNER)** en ContaFlow, empresa
**Tecnología y Suministros Andina C.A.** App: `http://localhost:3000`. Llega SIEMPRE por el menú
lateral (un 404 por URL tecleada NO es hallazgo).

**Prerrequisitos** (si no se cumplen: "prerequisito faltante", no bug): sesión OWNER activa ·
plan de cuentas con ≥ 2 cuentas · un período contable abierto · **suscripción de la empresa de
prueba vigente** (ver aviso abajo).

> ⚠️ **PRERREQUISITO DE ENTORNO — suscripción vigente (verificar ANTES de empezar).** Si al
> intentar la primera mutación aparece el banner **"Tu suscripción venció. Estás en modo solo
> lectura — renueva tu plan para volver a operar."**, eso NO es un hallazgo de la aplicación:
> es el gate de facturación cortando la escritura porque la suscripción de la empresa de prueba
> venció. Detén la sesión y avisa al usuario para que la restablezca — ninguna prueba de
> escritura es válida con este banner activo. Cómo detectarlo temprano: en el dashboard aparece
> un banner rojo de solo-lectura; si lo ves, no arranques. (El corte también puede activarse a
> mitad de sesión si la suscripción vence ese mismo día.)

> ⚠️ **PRERREQUISITO DE ENTORNO — base de datos (Neon) con cómputo disponible.** Si al cargar
> listados o reportes aparece el banner **"Error inesperado"**, o si las mutaciones/lecturas
> fallan de forma **intermitente y sin patrón**, puede deberse a que el proyecto Neon agotó su
> **cuota mensual de cómputo** (compute allowance al 100%) y está estrangulando conexiones. Eso
> NO es un hallazgo de la aplicación: es infraestructura. Detén la sesión y avísale al usuario —
> se resuelve del lado del entorno (upgrade del plan Neon o el reset mensual de la cuota), no en
> la app. Mientras el compute esté estrangulado, ningún resultado (lectura o escritura) es
> confiable para la auditoría.

---

## FASE 0 — RECONOCIMIENTO (observar, no tocar)

1. Abre **Contabilidad → Asientos** desde el menú. UNA captura. ¿Aparece la lista con sus
   pestañas (Asientos / Plan de Cuentas / Reportes)?
2. Documenta EN TEXTO: columnas de la lista, cuántos asientos hay, cuál es el **período activo**
   (mira de paso Períodos Contables), cuántas cuentas hay en el Plan de Cuentas, y el correlativo
   del último asiento del mes.

## FASE 1 — LIBRO DIARIO · FLUJO FELIZ (asientos que DEBEN grabar)

- **1.1** Nuevo Asiento **balanceado** de 2 líneas (ej: Dr Banco 1.000 / Cr Ventas 1.000, o dos
  cuentas cualesquiera del plan). Descripción válida, fecha dentro del período abierto.
  ✅ Se graba con correlativo `YYYY-MM-XXXXXX`; el detalle muestra "Sumas iguales" con Débito =
  Crédito. Verifica un total a mano.
- **1.2** Nuevo Asiento **de 3+ líneas** balanceado (ej: Dr Gasto 800 + Dr IVA CF 128 / Cr
  Banco 928). ✅ Graba; correlativo consecutivo al de 1.1 (sin salto ni duplicado).
- **1.3** Prueba cada **Tipo** disponible (Diario / Apertura / Ajuste / Cierre) en al menos uno.
  ✅ El tipo se refleja en el detalle y en el Libro Diario.
- **1.4** Abre el reporte **Libro Diario** (`…/reports/journal`): ✅ los asientos de 1.1-1.3
  aparecen en orden cronológico con folio y "Sumas iguales" que cuadran. Prueba el filtro por
  rango de fechas y la búsqueda por número/descripción.
- **1.5 (Anulación, si existe en la UI)**: en el detalle de un asiento POSTED, busca **Anular**.
  Si existe: anula con un motivo ≥ 10 caracteres. ✅ El original queda **Anulado (VOIDED)** y se
  crea un asiento espejo con montos invertidos (nuevo correlativo). Verifica que el par neutraliza
  el saldo. Si NO existe la opción en la UI → anótalo como observación (no bug), no la fuerces.

---

## CIERRE DE PARTE 1 — ACTA (genera esto como TEXTO al final, sin capturas)

```
ACTA PARTE 1 — LIBRO DIARIO (flujo feliz) — [fecha]
Empresa: Tecnología y Suministros Andina C.A. | Auditora: Daniela Quintero, CPC 51.077
Período activo observado: [Mes Año]  ·  Último correlativo del mes: [YYYY-MM-XXXXXX]

Fase 0: [nº de asientos previos, nº de cuentas en el plan, prerrequisitos OK/faltantes]
Fase 1 (flujo feliz), 1 línea por prueba:
  1.1 asiento 2 líneas → [nº asignado, ✅/❌]
  1.2 asiento 3+ líneas → [nº asignado, consecutivo sí/no]
  1.3 tipos probados → [cuáles]
  1.4 reporte Libro Diario / filtro / búsqueda → [✅/❌]
  1.5 anular → [existe en UI sí/no; si sí: original VOIDED + espejo nº]
Hallazgos de la Parte 1: [ref, severidad, evidencia — solo si los hubo]

Estado para las Partes 2 y 3:
- Período activo actual: [Mes Año] (déjalo ABIERTO — NO lo cierres; eso es Parte 3)
- Asientos creados en este período: [lista de nº]
- Cuentas útiles del plan para armar partidas: [2-3 códigos/nombres, para reusar en la Parte 2]
```

**El usuario copiará esta ACTA en la sesión de la Parte 2.** No hagas datos errados ni toques
Períodos en esta sesión.

---

## NOTAS PARA EL AGENTE BROWSER

- Navega SIEMPRE por el menú (un 404 por URL tecleada NO es hallazgo).
- Si el rate limiter bloquea ("Demasiadas solicitudes"), espera 1 minuto — no es bug.
- Si TODAS las mutaciones fallan con "Servicio temporalmente no disponible", es infraestructura
  local (Redis) — repórtalo como prerequisito de entorno y detén la sesión.
- Si TODAS las mutaciones fallan con "Tu suscripción venció. Estás en modo solo lectura…", es el
  gate de facturación (suscripción de la empresa de prueba vencida), NO un bug — repórtalo como
  prerequisito de entorno y detén la sesión (ver el aviso de prerrequisitos arriba).
- Si aparece "Error inesperado" al cargar listados/reportes o los errores son intermitentes y sin
  patrón, puede ser la cuota de cómputo de Neon agotada (infra), NO un bug — repórtalo como
  prerequisito de entorno y detén la sesión (ver el aviso de prerrequisitos arriba).
- **NO cierres ningún período en esta sesión.** El cierre es irreversible desde la UI y se
  audita en la Parte 3.
