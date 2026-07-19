# Prompt — Auditoría Períodos Contables · ContaFlow (v1 · PARTE 3 de 3)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)

> **PARTE 3 = Fases 3-5**: cierre de período + apertura del mes corriente + integración +
> INFORME FINAL consolidado. Requiere el **ACTA de la Parte 2** (que ya encadena la Parte 1).
> Pégala abajo.

---

## 📋 ACTA DE LA PARTE 2 — PEGAR AQUÍ

```
[Pega aquí el ACTA PARTE 2 generada en la sesión anterior, sin modificar. Ya incluye el
resumen de la Parte 1: período activo, correlativos, asientos creados.]
```

---

## 📸 ECONOMÍA DE CONTEXTO (OBLIGATORIA)

- Captura **SOLO** evidencia de hallazgos ⚠️/❌ y (opcional) UNA captura del historial de
  períodos tras el cierre/apertura. Todo lo demás EN TEXTO.
- Si la sesión se alarga antes de terminar la Fase 4, corta y emite el informe con lo cubierto,
  marcando lo no ejecutado como "pendiente".

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código ni la BD.** Solo la UI en `localhost:3000`. PROHIBIDO afirmar detalles
internos (snapshots, transacciones, isolation). Lo no observable → "no verificable desde la UI".

## ⚠️ ANTI-FALSO-POSITIVO (esencial para esta fase)

1. **Un período OPEN a la vez.** Solo puede haber un período contable Abierto por empresa. Que la
   app **no ofrezca** abrir un segundo mientras hay uno abierto es correcto (✅), no un bug.
2. **La UI avanza mes a mes.** El botón "Abrir" siempre ofrece **el mes siguiente al último
   período existente** (abierto o cerrado), NO necesariamente el mes calendario actual. Ejemplo:
   si el último período es Mayo, el botón ofrece **Junio** — no Julio. Para llegar a un mes
   posterior con meses intermedios sin abrir, hay que **abrir y cerrar cada mes intermedio**.
   Esto es el comportamiento esperado (no permite huecos); **no lo reportes como bug**, pero SÍ
   documéntalo como observación de usabilidad si el salto era largo.
3. **Cierre irreversible desde la UI.** Un período Cerrado no se reabre desde la pantalla; que no
   ofrezca "reabrir" es diseño, no carencia.
4. **Período CERRADO → no admite asientos ni anulaciones en ese mes.** Bloquearlo es correcto
   (R-3, Art. 36 Código de Comercio). ❌ Hallazgo CRÍTICO si permite asentar en un mes cerrado.
5. **Ejercicio económico cerrado bloquea el año.** Si el año fiscal fue cerrado, no se pueden
   abrir períodos ni registrar asientos de ese año. Correcto.
6. **Segregación de roles.** Abrir/Cerrar período requiere rol contable/admin (Propietario o
   Administrador). Que un rol operativo/lectura NO pueda hacerlo es correcto.
7. **Duplicar período** (abrir un mes que ya existe) debe bloquearse. Correcto.
8. **Evidencia en cada hallazgo** ⚠️/❌.

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, **Propietaria (OWNER)** en **Tecnología y Suministros Andina
C.A.** `http://localhost:3000` → menú lateral. Usa el estado dejado en el ACTA de la Parte 2.

**Períodos Contables — `…/periods`**: tarjeta del **Período Activo** + **Historial**. Botón
**Abrir [Mes Año]** (solo si no hay período abierto) y **Cerrar Período** (si hay uno abierto).
Cerrar es irreversible y muestra una advertencia.

---

## FASE 3 — PERÍODOS: CIERRE DE MES + APERTURA DEL MES CORRIENTE

> Objetivo: **cerrar el período abierto** y **abrir el mes corriente**. Ejecuta en este orden.
> Recuerda (anti-FP #2): el botón avanza al mes siguiente al último período; si hay meses
> intermedios sin abrir, tendrás que abrir/cerrar cada uno hasta llegar al mes corriente.

- **3.1 Estado inicial**: en **Períodos Contables**, anota el Período Activo, qué mes sugiere el
  botón "Abrir", y el historial (meses Abiertos/Cerrados).
- **3.2 (Control) Abrir con período ya abierto**: si hay un período abierto, verifica que la app
  **no ofrece** abrir otro (el botón "Abrir" no aparece mientras hay uno activo). ✅ Esperado.
- **3.3 CERRAR el período abierto**: pulsa **Cerrar Período**, confirma en el diálogo. ✅
  Esperado: el mes pasa a **Cerrado** en el historial y desaparece el "Período Activo". Anota la
  advertencia de irreversibilidad. (El cierre genera snapshots internamente — no verificable
  desde la UI, no lo afirmes.)
- **3.4 Verificar bloqueo post-cierre**: intenta crear un Nuevo Asiento con fecha del mes recién
  **cerrado** (usa un nº de asiento del ACTA como referencia de ese mes). ✅ Esperado: **rechazo**
  (período cerrado / fuera del período abierto). ❌ Hallazgo CRÍTICO si permite asentar.
- **3.5 ABRIR hasta el mes corriente**: pulsa **Abrir [Mes Año]**. Observa qué mes ofrece:
  - Si ofrece directamente el **mes corriente** → ábrelo. ✅
  - Si ofrece un mes intermedio (porque había un hueco), ábrelo, ciérralo y repite hasta llegar
    al mes corriente. Anota cuántos meses tuviste que abrir/cerrar y si el flujo fue claro
    (observación de usabilidad si fue tedioso). ✅ Al final, el **mes corriente** queda Abierto
    y es el Período Activo.
- **3.6 Registrar en el período recién abierto**: crea un asiento balanceado fechado en el mes
  corriente. ✅ Esperado: graba con correlativo del nuevo mes (`YYYY-MM-000001` o el que toque).
- **3.7 (Control) Duplicar período**: intenta abrir de nuevo un mes que ya existe. ✅ Esperado:
  bloqueo ("El período … ya existe" o similar).
- **3.8 (Roles, si dispones de otra cuenta)**: con un rol NO administrador (Administrativo/Viewer),
  intenta Cerrar/Abrir período. ✅ Esperado: bloqueado / botón ausente. Si no tienes esa cuenta →
  "no ejecutable, prerequisito de cuentas faltante".

## FASE 4 — INTEGRACIÓN Y AUDITORÍA

- **4.1 Libro Diario refleja todo**: los asientos de las Partes 1-2 y el de 3.6 aparecen en
  `…/reports/journal` con folio, fecha, número y "Sumas iguales" correctas. Un asiento **anulado**
  (si se hizo en 1.5) debe verse trazable (original + espejo), no borrado.
- **4.2 Correlativos**: numeración por mes consecutiva y **sin duplicados** entre todos los
  asientos (incluido el del mes nuevo abierto en 3.5-3.6).
- **4.3 Auditoría**: en el log de Auditoría, verifica que quedaron registrados **crear asiento**,
  **cerrar período** (CLOSE) y **abrir período** (OPEN) —y **anular** si aplica— con usuario,
  fecha/hora e IP. (Si User-Agent no es visible en la tabla, no concluyas "no se graba" — anótalo
  como "no visible en la UI".)

## FASE 5 — INFORME FINAL CONSOLIDADO

Consolida las ACTAs de las Partes 1-2 + esta sesión en este formato:

```
INFORME DE AUDITORÍA OPERATIVA — LIBRO DIARIO Y PERÍODOS CONTABLES (v1, 3 sesiones)
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditora: Daniela Quintero, CPC 51.077

1. RESUMEN EJECUTIVO
2. RECONOCIMIENTO (Parte 1): [secciones, período activo, correlativos, prerrequisitos]
3. FUNCIONALIDADES EVALUADAS
   Flujo                                 | ✅/⚠️/❌ | Observación
   Crear asiento balanceado (2 líneas)   |          |
   Crear asiento 3+ líneas               |          |
   Tipos de asiento (Diario/Apert/…)     |          |
   Reporte Libro Diario (filtro/búsq.)   |          |
   Anular asiento (si existe en UI)      |          |
   Cerrar período                        |          |
   Abrir hasta el mes corriente          |          |
   Registrar en período nuevo            |          |
4. VALIDACIONES Y CONTROLES — LIBRO DIARIO (E-1…E-11) [del ACTA Parte 2]
5. PERÍODOS — CIERRE/APERTURA (Fase 3): [resultado por paso; nº de meses abiertos/cerrados
   para llegar al mes corriente; bloqueo post-cierre verificado]
6. INTEGRACIÓN Y AUDITORÍA (Fase 4): [correlativos, log de auditoría]
7. HALLAZGOS (solo con evidencia + severidad calibrada)
8. RECOMENDACIONES
9. FALSOS POSITIVOS DESCARTADOS / DISEÑO CORRECTO VERIFICADO
10. CONCLUSIÓN [listo / requiere ajustes / no listo]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Rate limiter → espera 1 minuto. "Servicio temporalmente no disponible" en todas las mutaciones
  → infra local (Redis), prerequisito de entorno, detén la sesión.
- Banner "Error inesperado" al cargar listados/reportes, o errores intermitentes sin patrón →
  puede ser la cuota de cómputo de Neon agotada (infra), NO un bug — prerequisito de entorno,
  detén la sesión. (Crítico en esta Parte: no cierres un período si la BD está inestable.)
- Banner "Tu suscripción venció. Estás en modo solo lectura…" → gate de facturación, NO un bug —
  prerequisito de entorno, detén la sesión.
- **Deja el mes corriente ABIERTO al final** (paso 3.5-3.6) para no dejar la empresa sin período
  de trabajo. No cierres el período recién abierto.
