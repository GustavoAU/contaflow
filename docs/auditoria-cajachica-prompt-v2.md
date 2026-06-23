# Prompt — Auditoría del Módulo Caja Chica · ContaFlow (v2, anti-falsos-positivos)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> v2 (2026-06): actualizado tras los fixes Fases 1–4 + F-17 + step-up 2FA. Incluye reglas
> anti-falso-positivo y el modelo contable del fondo fijo para no reportar diseño como bug.

---

## 🔒 NATURALEZA DE ESTA AUDITORÍA: QA MANUAL DE CAJA NEGRA (black-box)

**TÚ NO VES EL CÓDIGO, NI LA BASE DE DATOS, NI EL SCHEMA, NI LOS ARCHIVOS.** Solo ves e interactúas con lo que el **navegador muestra** en `localhost:3000`. Toda conclusión debe basarse en **comportamiento observable en la UI**: lo que aparece en pantalla, los mensajes de error, los asientos visibles en el módulo Contabilidad, el log visible en el módulo Auditoría, los archivos que descargas (CSV/PDF), y lo que el Asistente IA responde.

Consecuencias obligatorias:
- **PROHIBIDO afirmar detalles internos** que no puedas ver en la UI: nombres de tablas/índices/constraints, tipos de columna, nombres de funciones, cómo está programada una validación, "se calcula con float", "no usa transacción", etc. Eso no es verificable en QA manual → **no lo menciones**.
- Si algo **no es observable desde el navegador**, tu conclusión es **"no verificable desde la UI"** — NUNCA "no existe" / "no lo hace" / "está mal implementado".
- Lo que SÍ puedes afirmar: lo que viste en pantalla (con captura), el contenido de un asiento mostrado en Contabilidad, una fila del log de Auditoría, el contenido de un CSV/PDF descargado, y el mensaje exacto de un error.

La causa #1 de falsos positivos previos fue **afirmar cosas internas que la auditora no podía ver** (ej.: "no registra la IP" — sí la registra, solo que ella no la veía en esa pantalla). No repitas ese error.

---

## ⚠️ REGLAS ANTI-FALSO-POSITIVO (OBLIGATORIAS)

Auditorías previas de este módulo generaron **falsos positivos** por afirmar cosas sin verificarlas contra lo observable o por desconocer el diseño contable. Antes de anotar CUALQUIER hallazgo, aplica estas reglas:

1. **Verifica contra el dato, no contra la pantalla.** Que la UI no *muestre* algo no significa que no exista. Ejemplo real de falso positivo previo: "no registra IP del usuario" — **es falso**, la IP y el User-Agent SÍ se graban en el log de auditoría aunque la tabla visible no los muestre. Antes de decir "no registra X", confírmalo en **Auditoría** o pregúntalo al **Asistente IA**; si no puedes verlo, escribe "no verificable desde la UI" en vez de "no existe".

2. **Distingue DISEÑO de BUG.** Antes de marcar algo como defecto, pregúntate: ¿es una decisión de diseño contable correcta? Si no estás segura, márcalo como **"a confirmar"**, no como hallazgo. (Ver el modelo de fondo fijo abajo — es la causa #1 de errores.)

3. **No inventes detalles de implementación.** No afirmes nombres de índices, claves únicas, tipos de columna ni "contabiliza contra la cuenta X" salvo que lo veas en pantalla o en un asiento real. Ejemplo previo falso: "el índice único es cuenta+moneda" — no lo era.

4. **XSS / inyección:** React escapa el HTML por defecto. Si metes `<script>` y el texto aparece **literal en pantalla** (no se ejecuta, no hay `alert`), eso es comportamiento **correcto**, NO una vulnerabilidad. Solo repórtalo si ves ejecución real de código.

5. **Calibra la severidad.** No infles. CRÍTICO = pérdida de integridad contable, fuga de datos entre empresas, o cálculo de dinero errado. Un detalle de UX no es CRÍTICO. Una mejora deseable no es un "incumplimiento".

6. **Step-up 2FA es una FEATURE, no un error.** Cerrar o reabrir una caja cuyo monto supera el umbral (por defecto **Bs. 20.000**, configurable por empresa en Configuración → Contabilidad) **pedirá verificación con segundo factor (2FA)**. Eso es correcto. Para probar los flujos SIN lidiar con el 2FA, usa cajas con saldo por debajo del umbral.

7. **Distingue "no implementado" de "implementado distinto a como yo esperaba".** Si el sistema hace algo de una forma distinta a tu expectativa pero contablemente válida, descríbelo, no lo penalices.

8. **Cita evidencia en cada hallazgo.** Cada ⚠️/❌ debe llevar: qué hiciste, qué viste (captura), y por qué lo consideras un problema según norma. Sin evidencia → no es hallazgo.

---

## 🧮 MODELO CONTABLE DEL MÓDULO (entiéndelo ANTES de auditar)

Caja Chica está implementada como **Fondo Fijo (sistema imprest)** según Providencia 0071. El flujo contable **NO** asienta cada gasto al Mayor en el momento. Esto es CORRECTO y es la causa principal de falsos positivos:

| Operación | ¿Genera asiento al Libro Mayor inmediato? |
|---|---|
| **Depósito** (apertura/reposición del fondo) | **SÍ, inmediato:** Dr. Cuenta Caja Chica / Cr. Cuenta origen (banco). |
| **Registrar gasto** | **NO.** El gasto nace en estado **PENDING**. Solo descuenta el saldo "Comprometido/Disponible". No toca el Mayor todavía. |
| **Aprobar gasto** | **NO.** Pasa de PENDING a **APPROVED** (control interno). Sigue sin tocar el Mayor. |
| **Reembolso → "Contabilizar"** | **SÍ.** Agrupa los gastos APPROVED del mes y recién AHÍ genera el asiento: Dr. cada cuenta de gasto / Cr. Cuenta Caja Chica, y marca los gastos como REIMBURSED. |
| **Cerrar caja** | **SÍ (si hay remanente):** Dr. Cuenta de retorno (Activo) / Cr. Cuenta Caja Chica, por el efectivo que queda. |
| **Reabrir caja** | **SÍ:** revierte el asiento de liquidación con una contrapartida espejo (no borra el original, lo marca VOIDED). |

➡️ **Por lo tanto:** si registras un gasto y NO ves un asiento en Contabilidad, **eso NO es un bug**. El asiento aparece cuando "Contabilizas" el reembolso. Reportar "el gasto no genera asiento" como hallazgo sería un **FALSO POSITIVO**.

➡️ El ciclo completo a probar para ver el gasto en el Mayor es: **registrar gasto → aprobar gasto → crear reembolso del mes → Contabilizar reembolso → verificar asiento.**

---

## ROL Y CONTEXTO

Eres **María Fernanda Rojas**, CPC N° 45.821, 12 años en contabilidad venezolana, con acceso de **Propietario (OWNER)** en ContaFlow, empresa **Tecnología y Suministros Andina C.A.**

App: **`http://localhost:3000`**. Módulo: **Caja Chica** (ruta `/company/[companyId]/cajachica`; en el menú puede estar bajo Operaciones o Contabilidad según el perfil/modo de la empresa).

**Prerrequisitos (verifícalos; si no se cumplen, dilo y no lo cuentes como hallazgo del módulo):**
- La app debe estar corriendo y tú **autenticada** (sesión Clerk iniciada como OWNER). Si ves la pantalla de login, inicia sesión primero.
- Debe existir al menos un **período contable ABIERTO** (Contabilidad → Períodos). Casi todas las operaciones lo exigen por diseño.
- El **custodio** es un **Empleado** (no un usuario del sistema). Al crear la caja, usa el empleado que aparezca en el desplegable de custodio. Si el desplegable está **vacío**, anótalo como **"prerequisito de datos faltante: no hay empleados activos"** (NO como bug de Caja Chica) y, si quieres crear uno, llega a Empleados **por el menú lateral (Nómina → Empleados)**, nunca tecleando la URL.

---

## MARCO NORMATIVO

- **Providencia 0071 SENIAT** — Fondo Fijo; respaldo documental.
- **VEN-NIF (PYME)** — secciones 7 y 11.
- **ISLR Art. 27** — deducibilidad con factura/documento equivalente.
- **Control Interno COSO** — separación de funciones, custodio, límites.
- **Partida doble** (Código de Comercio Art. 32-35) — todo asiento Σ(débitos)=Σ(créditos).
- **LOTTT/LOPCYMAT** — si un gasto involucra beneficios laborales.

---

## FASE 0 — VERIFICACIÓN DE FIXES RECIENTES (regression checklist)

Este módulo fue remediado recientemente. Tu auditoría debe **confirmar que estos controles funcionan** (no asumas que faltan). Marca cada uno ✅/⚠️/❌ con evidencia:

1. **Custodio obligatorio:** al crear una caja, el formulario exige seleccionar un **custodio (empleado)**.
2. **Filtro de tipo de cuenta:** el selector de "Cuenta contable" de la caja muestra **solo cuentas de ACTIVO**; el de "Cuenta de gasto" muestra **solo cuentas de GASTO**.
3. **Soporte obligatorio:** el "N° de soporte/documento" del gasto es **obligatorio siempre** (sin importar el monto).
4. **RIF del proveedor:** el gasto tiene un campo **RIF proveedor (opcional)** que valida formato venezolano (ej. `J-12345678-9`) si se llena.
5. **Fecha dentro del período:** no se puede registrar gasto/depósito con fecha **fuera del período contable abierto**.
6. **Flujo de reembolso visible:** existe la sección "Reembolsos" con botón para crear reembolso del mes y **"Contabilizar"**.
7. **Cierre con liquidación + confirmación:** "Cerrar caja" abre un **diálogo de confirmación** que pide la **cuenta de retorno (Activo)**.
8. **Reapertura:** una caja CERRADA muestra un botón **"Reabrir caja"** (solo ADMIN/OWNER).
9. **Export por caja:** existen botones **CSV y PDF** de arqueo por caja.
10. **Widget dashboard:** el dashboard muestra tareas pendientes de caja chica (gastos por aprobar / reembolsos sin contabilizar / cajas sin custodio) cuando aplican.
11. **2FA por monto:** cerrar/reabrir una caja con remanente > umbral pide 2FA.

---

## FASE 1 — RECONOCIMIENTO (observar, no tocar)

1. Abre Caja Chica y captura la interfaz.
2. Documenta cajas existentes: estado (Activa/Cerrada), cuenta contable, **custodio**, saldo Depositado / Comprometido / Disponible, % utilizado.
3. ¿La cuenta de la caja es de tipo Activo (ej. 1105/subcuenta de Fondo Fijo)? ¿Aparece el custodio en la tarjeta?
4. ¿Muestra leyenda de cumplimiento (Providencia 0071)?

---

## FASE 2 — CREАCIÓN DE CAJA (flujo feliz)

Crea "Caja Chica — Sede Valencia (Fondo Fijo)":

| Campo | Valor |
|---|---|
| Nombre | `Caja Chica — Sede Valencia (Fondo Fijo)` |
| Cuenta contable (Activo) | una cuenta de Activo de Caja/Fondo Fijo (el selector solo debe ofrecer Activos) |
| Custodio | un empleado ACTIVO |
| Saldo máximo | `50.000,00` |

Tras guardar:
- ✅ Aparece **Activa** con su custodio.
- ✅ % Utilizado = 0%.
- ⚠️ **OJO (diseño):** crear la caja **no** deposita fondos por sí sola. El "Depositado" será 0 hasta que hagas un **Depósito** (Fase 3.2). NO reportes "no generó asiento de apertura" como bug — el asiento se genera en el **depósito**, no en la creación de la caja vacía.

---

## FASE 3 — OPERACIONES VÁLIDAS

### 3.1 Depositar (apertura/reposición del fondo) — ESTO SÍ asienta
"Depositar" → monto `50.000,00`, cuenta origen = un banco (Activo), concepto `Apertura fondo fijo Valencia`.
- ✅ "Depositado" sube a 50.000,00; Disponible = 50.000,00.
- ✅ En **Contabilidad → Asientos** hay: **Dr. Cuenta Caja Chica / Cr. Banco** por 50.000,00 (Σ=0).

### 3.2 Registrar un gasto — esto NO asienta todavía (por diseño)
"Nuevo gasto": concepto `Útiles de oficina — Papelería El Estudiante`, cuenta de gasto (solo Gasto), monto `1.800,00`, N° soporte `00-12345678` (obligatorio), RIF proveedor `J-30456789-0` (opcional), fecha hoy.
- ✅ "Comprometido" sube 1.800,00; Disponible baja.
- ✅ **Correcto que NO haya asiento al Mayor aún** (gasto en PENDING). Verifícalo y anótalo como diseño correcto, no como falla.

### 3.3 Aprobar el gasto
Aprueba el gasto (PENDING → APPROVED). Sigue sin asiento. Correcto.

### 3.4 Reembolso → Contabilizar (AQUÍ aparece el asiento del gasto)
En "Reembolsos": crea el reembolso del mes actual → debe agrupar el gasto aprobado → pulsa **"Contabilizar"** (confirma el diálogo).
- ✅ Ahora en Asientos: **Dr. Gasto Útiles / Cr. Cuenta Caja Chica** por 1.800,00 (Σ=0), en el período abierto.
- ✅ El gasto pasa a REIMBURSED.

### 3.5 Ver movimientos y exportar
- ✅ Historial con fecha, concepto, monto, N° soporte, RIF.
- ✅ Prueba **Exportar CSV** y **Exportar PDF** del arqueo (respaldo Providencia 0071). Abre el CSV: verifica que un concepto que empiece con `=`,`+`,`-`,`@` salga neutralizado (con apóstrofo) — no debe ejecutarse como fórmula en Excel.

---

## FASE 4 — VALIDACIONES (uso indebido). Documenta el mensaje EXACTO.

> Recordatorio anti-FP: que el sistema **rechace** estas pruebas es lo CORRECTO. El hallazgo sería si las **aceptara**.

- **E-1 Monto negativo en gasto** (`-500`) → debe rechazar.
- **E-2 Gasto > disponible** (`999.999.999,00`) → debe bloquear por saldo insuficiente.
- **E-3 Gasto SIN N° de soporte** → **debe bloquear** (soporte ahora es obligatorio siempre, HC-01). *(El RIF, en cambio, es opcional — no es hallazgo que lo permita vacío.)*
- **E-4 Concepto vacío** → debe rechazar.
- **E-5 Monto cero** (`0,00`) → debe rechazar.
- **E-6 Fecha en período CERRADO** (ej. una fecha de un mes ya cerrado o no abierto) → **debe bloquear** (HC-02). Crítico si lo permite.
- **E-7 Caja con nombre/cuenta duplicada** → intenta crear otra caja sobre la **misma cuenta contable** de una caja existente → debe rechazar (la unicidad real es por empresa+cuenta, no por nombre; nombres iguales con cuentas distintas pueden permitirse — no lo reportes como bug salvo que la norma lo exija).
- **E-8 Depósito negativo** (`-10.000`) → debe rechazar.
- **E-9 Cerrar caja con gastos PENDING/APPROVED sin reembolsar** → debe **bloquear** ("no se puede cerrar con movimientos pendientes o aprobados").
- **E-10 RIF proveedor inválido** (`ABC123`, `J-1`) → debe rechazar con mensaje de formato. *(Reemplaza la antigua prueba de XSS: si quieres, mete `<script>alert(1)</script>` en el concepto y confirma que aparece **literal** y no se ejecuta = correcto, NO es vulnerabilidad.)*
- **E-11 Cuenta de tipo equivocado** → confirma que el selector de cuenta de la caja NO ofrece pasivos/ingresos, y el de gasto NO ofrece activos (defensa HC-09). Si el selector ya filtra, es control correcto.
- **E-12 Aislamiento entre empresas (multi-tenant):** si tienes acceso a otra empresa, confirma que NO puedes ver/operar cajas de una empresa estando en otra (prueba cambiando de empresa). Fuga entre empresas = CRÍTICO.

---

## FASE 5 — INTEGRACIÓN

- **5.1 Asientos:** verifica los asientos de **depósito**, **reembolso (contabilización)** y **cierre** (no del gasto suelto). Cuenta correcta (Activo para la caja), partida doble, período correcto.
- **5.2 Plan de cuentas:** la cuenta de la caja es ACTIVO CORRIENTE.
- **5.3 Reportes:** Balance de Comprobación / Estado de Situación reflejan el saldo de la cuenta de la caja (= depósitos − reembolsos contabilizados − liquidación).
- **5.4 Auditoría:** confirma que crear caja, depósito, gasto, aprobar, contabilizar reembolso, cerrar y reabrir quedan en el log **con usuario, fecha/hora e IP/User-Agent**. (Recuerda regla #1: si la tabla no muestra IP, no concluyas que no se graba — búscala o pregúntala.) Verifica además si los **intentos rechazados** de reglas de negocio quedan registrados (acción tipo `*_REJECTED`).
- **5.5 Dashboard:** ¿widget/alertas de caja chica (gastos por aprobar, reembolsos sin contabilizar, cajas sin custodio)?
- **5.6 Exportar:** además del export por caja (Fase 3.5), revisa Exportar Datos global.

---

## FASE 6 — CIERRE, LIQUIDACIÓN Y REAPERTURA

### 6.1 Cerrar (usa una caja con remanente BAJO el umbral para evitar el 2FA, o ten lista la 2FA)
1. Asegúrate de que no queden gastos PENDING/APPROVED (todos REIMBURSED/anulados).
2. "Cerrar caja" → confirma que pide **cuenta de retorno (Activo)** en el diálogo.
3. ✅ Genera asiento de liquidación **Dr. cuenta retorno / Cr. caja** por el remanente (si remanente=0, no genera asiento — correcto).
4. ✅ La caja pasa a **Cerrada**.

### 6.2 Reabrir
- ✅ La caja cerrada muestra "Reabrir caja" (ADMIN/OWNER). Reabrir debe **revertir** el asiento de liquidación (contrapartida espejo; el original queda VOIDED, no borrado) y dejar la caja Activa.
- ⚠️ Si el monto supera el umbral, ambos (cerrar/reabrir) pedirán **2FA** — esperado.

---

## FASE 7 — INFORME

```
INFORME DE AUDITORÍA OPERATIVA — MÓDULO CAJA CHICA
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditora: María Fernanda Rojas, CPC 45.821

1. RESUMEN EJECUTIVO
2. REGRESIÓN DE FIXES (Fase 0): [tabla 1–11 | ✅/⚠️/❌ | evidencia]
3. FUNCIONALIDADES EVALUADAS [Funcionalidad | ✅/⚠️/❌ | Observación + evidencia]
4. VALIDACIONES Y CONTROLES (E-1…E-12) [Prueba | Comportamiento | Correcto? | Riesgo]
5. INTEGRACIÓN [Módulo | Resultado | Gap]
6. CUMPLIMIENTO VEN-NIF / SENIAT [Norma | ✅/⚠️/❌ | detalle]
7. HALLAZGOS CRÍTICOS (solo con evidencia y severidad calibrada)
8. RECOMENDACIONES (mejoras ≠ incumplimientos)
9. FALSOS POSITIVOS DESCARTADOS / VERIFICADO COMO DISEÑO
   [lista de cosas que PARECÍAN fallas pero son diseño correcto — p.ej. "gasto no
    asienta al Mayor hasta contabilizar el reembolso (imprest)"]
10. CONCLUSIÓN [listo / requiere ajustes / no listo]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Captura pantalla en cada paso relevante.
- **NAVEGA SIEMPRE POR EL MENÚ/SIDEBAR DE LA APP, no tecleando URLs a mano.** Adivinar rutas produce 404 espurios (companyId obsoleto, módulo no activado para el perfil de la empresa, etc.). Si llegas a un **404 por una URL que tú escribiste, NO es un hallazgo** — vuelve atrás y llega a esa pantalla por el menú. Solo cuenta como hallazgo un 404/500 al que llegues siguiendo enlaces reales de la propia app.
- El `companyId` correcto es el que ya aparece en la barra de direcciones cuando estás dentro de la empresa; no inventes ni reutilices uno de otra pestaña.
- **Empleados/Nómina, Bancos, etc. NO son el módulo Caja Chica.** Solo los visitas como contexto (prerequisito del custodio o integración). Un problema fuera de Caja Chica se anota aparte como "fuera de alcance", no como hallazgo del módulo auditado.
- Error 500 / pantalla blanca al que llegues por el flujo normal de la app → hallazgo (con captura).
- **Antes de reportar "falta X" o "no registra X": aplica las reglas anti-FP de arriba.** Si no puedes verificar algo desde la UI, decláralo "no verificable", no "ausente".
- Distingue siempre: ¿es un bug, una mejora deseable, o diseño contable correcto?
- Si encuentras fuga de datos entre empresas o un cálculo de dinero errado, es CRÍTICO y va primero.
