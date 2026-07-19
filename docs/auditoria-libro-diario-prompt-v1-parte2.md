# Prompt — Auditoría Libro Diario · ContaFlow (v1 · PARTE 2 de 3)

### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)

> **PARTE 2 = Fase 2**: datos errados en el formulario de asientos (E-1…E-11) — la app DEBE
> rechazarlos o comportarse bien. Requiere el **ACTA de la Parte 1** (pégala abajo).
> **PARTE 3 (sesión aparte)**: cierre/apertura de períodos + integración + informe final.

---

## 📋 ACTA DE LA PARTE 1 — PEGAR AQUÍ

````
```ACTA PARTE 1 — LIBRO DIARIO (flujo feliz) — 18/07/2026
Empresa: Tecnología y Suministros Andina C.A. | Auditora: Daniela Quintero, CPC 51.077

Período activo observado: Mayo 2026  ·  Último correlativo del mes (antes de pruebas): 2026-05-000010

Fase 0: 42 asientos previos en el sistema (17 registrados en Mayo 2026, 21 en Abril 2026 según Períodos
Contables). Plan de Cuentas con 36 cuentas activas (Activo/Pasivo/Patrimonio/Ingreso/Gasto/Contra-activo).
Períodos: Mayo 2026 = Abierto (desde 22/5/2026); Abril 2026 = Cerrado (22/5/2026).
Prerrequisitos: OK (sesión OWNER activa, ≥2 cuentas, período abierto, sin banner de solo-lectura/suscripción).
Observación: muchos asientos de la lista usan numeración propia de otros módulos (Compras/Ventas/Caja
Chica, ej. "CMP-F-3001", "DEP-000003") en vez del correlativo YYYY-MM-XXXXXX; el correlativo automático
estándar solo aparece en asientos creados manualmente desde "Nuevo Asiento" (no es hallazgo, es diseño
observado).

Fase 1 (flujo feliz), 1 línea por prueba:
  1.1 asiento 2 líneas → 2026-05-000011, ✅ (Dr BNC 1.000,00 / Cr Ventas 1.000,00, Sumas iguales 1.000,00=1.000,00)
  1.2 asiento 3+ líneas → 2026-05-000012, consecutivo sí (Dr Alquiler 800 + Dr IVA CF 128 / Cr BNC USD 928)
  1.3 tipos probados → Apertura (2026-05-000013), Ajuste (2026-05-000014), Cierre (2026-05-000015) — los 3
      tipos se reflejaron correctamente en el detalle y en el reporte Libro Diario
  1.4 reporte Libro Diario / filtro / búsqueda → ✅ (orden cronológico f.001-f.005 correcto, Sumas iguales
      cuadradas; filtro de fechas 25-27/5/2026 mostró exactamente 3 asientos; búsqueda por texto "Auditoria QA"
      encontró los 5 asientos de prueba correctamente)
  1.5 anular → NO existe en la UI (verificado en el detalle del asiento 2026-05-000011, estado Contabilizado;
      no se encontró botón "Anular" en ninguna parte de la pantalla ni en el árbol de elementos interactivos) —
      observación, no bug

Hallazgos de la Parte 1: ninguno. Todos los correlativos fueron consecutivos y únicos (000011→000015), sin
saltos ni duplicados; todas las Sumas iguales cuadraron correctamente.

Estado para las Partes 2 y 3:
- Período activo actual: Mayo 2026 (dejado ABIERTO — no se tocó Períodos Contables)
- Asientos creados en este período: 2026-05-000011, 2026-05-000012, 2026-05-000013, 2026-05-000014, 2026-05-000015
- Cuentas útiles del plan para armar partidas: 1110 (BNC — Cuenta de Ahorro VES), 1120 (IVA Crédito Fiscal),
  4110 (Ventas — Equipos y Tecnología), 5120 (Alquiler de Locales)

---

## 📸 ECONOMÍA DE CONTEXTO (OBLIGATORIA)

- Captura **SOLO** evidencia de un rechazo relevante o un hallazgo ⚠️/❌ (el mensaje de error).
  Los casos que se comportan como se espera van EN TEXTO ("✅ E-1 rechazado: 'Asiento
  desbalanceado…'").
- No captures el formulario vacío ni repitas la misma pantalla. Un mensaje de error por captura,
  y solo cuando sea evidencia de hallazgo.
- Si la sesión se alarga antes de terminar E-11, corta y emite el ACTA con lo cubierto.

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código ni la BD.** Solo la UI en `localhost:3000`. PROHIBIDO afirmar detalles
internos. Lo no observable → "no verificable desde la UI".

## ⚠️ ANTI-FALSO-POSITIVO (esencial para esta fase)

1. **Rechazar es el control funcionando (✅), no un bug.** El objetivo de esta fase es que la app
   **bloquee** los datos malos. El hallazgo es lo contrario: que un dato inválido **pase**.
2. **Partida doble.** ❌ Hallazgo CRÍTICO solo si un asiento descuadrado (Σ Débitos ≠ Σ Créditos)
   logra **grabar**. Si el botón Guardar queda deshabilitado por Diferencia ≠ 0, es correcto (✅).
3. **Fecha fuera del período abierto** debe rechazarse. ❌ Hallazgo si graba en un mes distinto
   al período OPEN.
4. **Validación nativa del navegador** (campos numéricos que no aceptan letras/negativos, "campo
   requerido") cuenta como control válido (✅), no como carencia.
5. **Totales server-side.** Si intentas forzar un total desde la UI y el servidor lo recalcula o
   lo ignora, es correcto (✅).
6. **XSS**: que el texto se muestre **escapado** (literal, sin ejecutar) es lo correcto (✅).
7. **Severidad calibrada.** CRÍTICO = descuadre que graba · fecha fuera de período que pasa ·
   XSS que ejecuta · correlativo duplicado. Un mensaje de error poco claro es UX, no CRÍTICO.
8. **Evidencia en cada hallazgo** ⚠️/❌. Registra siempre el **mensaje exacto** que devolvió la app.

## ✅ FIX DE ESTE CICLO — verifica que funciona, NO lo re-reportes

- **Anular asiento (gap cerrado 2026-07)**: en la Parte 1 se observó que NO existía forma de
  anular un asiento desde la UI. Ese gap **ya fue corregido**: el detalle de un asiento
  **Contabilizado** ahora muestra un botón **"Anular"** (visible solo para rol Propietario/
  Administrador). Al confirmar con un motivo, el asiento original queda **Anulado** y se crea un
  **asiento de reversión** con los montos invertidos (nunca se borra — "NEVER DELETE → VOID").
  Esta Parte 2 lo verifica en E-12…E-15. Que el botón exista y funcione es el fix (✅) — repórtalo
  como verificado, no como hallazgo. Si el botón NO aparece para un OWNER en un asiento POSTED,
  eso SÍ sería una regresión del fix (repórtala con prioridad).

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, **Propietaria (OWNER)** en **Tecnología y Suministros Andina
C.A.** `http://localhost:3000` → menú → **Contabilidad → Asientos → Nuevo Asiento**. Usa las
cuentas del plan que anotaste en el ACTA de la Parte 1 para armar las partidas.

Recordatorio del formulario: Fecha · Tipo (Diario/Apertura/Ajuste/Cierre) · Descripción (mín. 3) ·
líneas (mín. 2), cada una Cuenta + Débito **o** Crédito. Muestra la **Diferencia** en vivo y solo
habilita Guardar si está balanceado. **NO cierres ningún período** (eso es Parte 3).

---

## FASE 2 — LIBRO DIARIO · DATOS ERRADOS

Para cada prueba: registra el **mensaje exacto** y si bloqueó o dejó pasar.

- **E-1 Descuadrado**: asiento con Dr 1.000 / Cr 900. ✅ Esperado: **rechazo** ("Asiento
  desbalanceado…" o Guardar deshabilitado por Diferencia ≠ 0). ❌ CRÍTICO si graba.
- **E-2 Una sola línea**: intenta guardar con 1 sola partida. ✅ Esperado: "Mínimo 2 líneas"
  (o no permite quitar la segunda fila).
- **E-3 Débito Y Crédito en la misma línea**: llena ambos en una fila. ✅ Esperado: "Solo Débito
  O Crédito, no ambos".
- **E-4 Línea vacía**: fila con cuenta pero sin Débito ni Crédito. ✅ Esperado: "Ingresa Débito
  o Crédito".
- **E-5 Descripción muy corta**: 1-2 caracteres. ✅ Esperado: "Mínimo 3 caracteres".
- **E-6 Monto negativo / fuera de rango**: débito negativo o número gigante. ✅ Esperado: rechazo
  ("Monto fuera del rango permitido") o que el campo no lo acepte.
- **E-7 Fecha absurda (año)**: fecha con año `12026` (o `1800`). ✅ Esperado: **rechazo** con
  "Fecha inválida o fuera del rango permitido (1900–2100)". Repórtalo como control verificado (✅).
- **E-8 Fecha fuera del período abierto**: si el período abierto es (p.ej.) Julio 2026, intenta
  un asiento fechado en otro mes (Enero 2026 o Agosto 2026). ✅ Esperado: **rechazo** indicando
  que la fecha no corresponde al período abierto. ❌ Hallazgo si graba fuera del período.
- **E-9 Total manipulado**: si logras alterar un total desde la UI, verifica que el servidor lo
  recalcula/ignora. Si no es manipulable desde la UI → "no manipulable" (✅).
- **E-10 XSS/inyección en texto**: asiento con `<script>alert(1)</script>` en Descripción y en la
  descripción de una línea. ✅ Esperado: se renderiza como texto literal, sin ejecutar el alert.
  Evidencia: captura de la fila con el texto escapado.
- **E-11 Doble submit**: en un asiento balanceado, pulsa Guardar dos veces rápido. ✅ Esperado:
  un solo asiento creado (botón deshabilitado / aria-busy mientras procesa), sin correlativo
  duplicado. Recarga el Libro Diario para confirmar que hay UNO solo.

### Anulación de asientos (verificación del fix — E-12…E-15)

Usa uno de los asientos que TÚ creaste en la Parte 1 (p.ej. 2026-05-000013, tipo Apertura) para
no anular documentos con efecto en otros módulos.

- **E-12 (fix, flujo feliz) Anular un asiento POSTED**: abre el detalle de un asiento
  **Contabilizado**, pulsa **Anular**, escribe un motivo válido (≥ 10 caracteres) y confirma.
  ✅ Esperado: aparece un aviso con el número del **asiento de reversión**; al recargar, el
  original figura como **Anulado** y el reverso tiene los montos invertidos (Débito↔Crédito).
  Verifica en el Libro Diario que ambos existen (original + reverso) y que el par neutraliza el
  saldo. ❌ Hallazgo si el asiento se **borra** en vez de quedar Anulado, o si el reverso no
  cuadra.
- **E-13 Motivo muy corto**: intenta anular con un motivo de 1-3 caracteres. ✅ Esperado: el
  botón de confirmar queda **deshabilitado** (o rechazo con mensaje de mínimo de caracteres).
- **E-14 Doble anulación**: sobre el asiento que ya anulaste en E-12, intenta anularlo otra vez.
  ✅ Esperado: ya NO aparece el botón "Anular" (el asiento está Anulado), o si se fuerza, la app
  responde "ya fue anulada". ❌ Hallazgo si permite anular dos veces (doble reverso).
- **E-15 (Roles, si dispones de otra cuenta)**: con un rol NO administrador (Administrativo/
  Viewer), abre el detalle de un asiento POSTED. ✅ Esperado: el botón **"Anular" NO aparece**.
  Si no tienes esa cuenta → "no ejecutable, prerequisito de cuentas faltante".

_Nota (no re-reportar como bug sin más): el asiento de reversión se registra con la fecha del día
de la anulación — es práctica contable válida para un asiento espejo. Si observas algo llamativo
en la **fecha o el correlativo del reverso** respecto al período, anótalo como observación para la
Parte 3, con evidencia, sin asumir causa interna._

---

## CIERRE DE PARTE 2 — ACTA (genera esto como TEXTO al final)

````

ACTA PARTE 2 — LIBRO DIARIO (datos errados) — [fecha]

[Pega aquí, sin modificar, el resumen del ACTA PARTE 1: período activo, correlativos, asientos
creados y cuentas útiles.]

Fase 2 (E-1..E-11), 1 línea por prueba — mensaje EXACTO y ✅/⚠️/❌:
E-1 descuadrado → [mensaje / resultado]
E-2 una línea → […]
E-3 débito+crédito → […]
E-4 línea vacía → […]
E-5 descripción corta → […]
E-6 monto negativo/rango → […]
E-7 año 12026 → […]
E-8 fecha fuera de período → […]
E-9 total manipulado → […]
E-10 XSS → […]
E-11 doble submit → […]
E-12 anular POSTED (fix) → [nº reverso, original Anulado ✅/❌]
E-13 motivo corto → […]
E-14 doble anulación → […]
E-15 anular sin rol admin → [botón ausente ✅ / no ejecutable]
Fix "Anular asiento": [✅ verificado / ❌ regresión + detalle]
Hallazgos de la Parte 2: [ref, severidad, evidencia — solo si los hubo]

Estado para la Parte 3:

- Período activo actual: [Mes Año] (sigue ABIERTO — NO se cerró en esta sesión)
- Asientos válidos creados hasta ahora (Partes 1 y 2): [lista de nº — para verificar el bloqueo
  tras el cierre en la Parte 3]

```

**El usuario copiará esta ACTA en la sesión de la Parte 3.** No toques Períodos en esta sesión.

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Rate limiter → espera 1 minuto. "Servicio temporalmente no disponible" en todas las mutaciones
  → infra local (Redis), prerequisito de entorno, detén la sesión.
- Banner "Error inesperado" al cargar listados/reportes, o errores intermitentes sin patrón →
  puede ser la cuota de cómputo de Neon agotada (infra), NO un bug — prerequisito de entorno,
  detén la sesión.
- Banner "Tu suscripción venció. Estás en modo solo lectura…" → gate de facturación (suscripción
  de la empresa de prueba vencida), NO un bug — prerequisito de entorno, detén la sesión.
- **NO cierres ningún período en esta sesión.** El cierre es irreversible desde la UI y se
  audita en la Parte 3.
```
