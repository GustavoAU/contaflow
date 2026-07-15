# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 2B de 4)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> **PARTE 2B = seguridad y roles** (E-17..E-20). Sesión corta y liviana.
> Secuencia completa: 1 → 2A → 2B → 3.

---

## 📋 ACTA DE LA PARTE 2A (2026-07-14) — contexto heredado

Heredado: E-2..E-6, E-8, E-9 ✅ (ciclo v1) — sin re-correr.

- **E-1** Sin ítems: bloqueado (validación nativa; no se puede quitar la última fila). ✅
- **E-7** Total manipulado: no manipulable desde la UI (total derivado). ✅
- **E-10/E-11** Transiciones inválidas: bloqueadas por ocultamiento del control según estado. ✅
- **E-12** Doble conversión: orden Convertida solo ofrece "Clonar"; un solo asiento FAC-F-2001. ✅
- **E-13** Editar documento terminal: no existe acción de edición en la UI. ✅
- **E-14** ⚠️ HALLAZGO: conversión con fecha 15/01/2025 (mes SIN período contable) fue ACEPTADA
  — factura F-9002 creada y asiento FAC-F-9002 "Contabilizado" con fecha 14/1/2025. No hay
  validación de período inexistente en la conversión (solo bloquea período CERRADO).
- **E-15** Reportado como CRÍTICO en 2A, **RECLASIFICADO tras verificación en código/BD**: el
  duplicado observado fue VENTA F-2001 vs COMPRA F-2001. El número de una factura de COMPRA
  pertenece al PROVEEDOR y puede coincidir legítimamente con la serie propia de venta. La
  unicidad real (verificada a nivel BD, índices parciales Fix A3): venta única por
  (empresa + número); compra única por (empresa + RIF proveedor + número). → **Falso positivo
  por diseño**. NO re-reportar en el informe final; registrarlo en "falsos positivos descartados".
- **E-16** ⚠️ HALLAZGO: RIF malformado "X-99" aceptado en la orden (OC-0006) y PROPAGADO a la
  factura fiscal F-9003 y al Libro de Compras. La conversión no valida RIF antes de crear el
  documento fiscal.

Documentos residuales: OV-0004 → Convertida (F-9002, fecha 14/1/2025) · OC-TESA-001 →
Convertida (F-2001 compra) · OC-0006 → Convertida (F-9003, RIF X-99) · sin cambios:
COT-0004 (Aprobada), PRE-0006 (Borrador), OC-0003/OV-0003 (Borrador), OV-TESA-001 (Aprobada).

> Nota para esta sesión 2B: los hallazgos E-14/E-16 (y los 2 de Parte 1: fecha de asiento
> −1 día, SALIDA de inventario no generada) YA están en el expediente — NO los re-reportes.

## 🪫 PRESUPUESTO DE ACCIONES (OBLIGATORIO)

- Mínimo de navegaciones; capturas SOLO para evidencia de hallazgos ⚠️/❌.
- Al terminar las 4 pruebas (o antes, si la sesión se alarga): EMITE EL ACTA y detente.

## 🔒 CAJA NEGRA + ANTI-FALSO-POSITIVO (esencial)

- NO VES código ni BD — solo la UI. Lo no observable → "no verificable desde la UI".
- **XSS**: si `<script>` aparece LITERAL sin ejecutarse = correcto (React escapa por defecto).
  Solo es hallazgo si ves ejecución real.
- **SQLi**: el texto debe guardarse como texto normal, sin error 500.
- **Roles**: ADMINISTRATIVE crea/clona pero NO aprueba/convierte — que lo bloquee es
  segregación de funciones correcta (COSO), no una carencia. VIEWER = solo lectura.
- Fuga entre empresas = CRÍTICO.
- Si no tienes acceso a otra empresa u otros roles, marca la prueba como "no ejecutable —
  prerequisito de cuentas faltante" (NO como hallazgo).

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, OWNER en **Tecnología y Suministros Andina C.A.**
`http://localhost:3000` → menú Operaciones → Compras y Ventas.

---

## FASE 3-B — SEGURIDAD / ROBUSTEZ

- **E-17 XSS** → crea UNA cotización mínima con `<script>alert(1)</script>` en descripción
  del ítem, nombre de contraparte y notas → verifica que aparece literal, sin ejecutarse.
- **E-18 Inyección SQL** → en la MISMA cotización (o una segunda), usa
  `'; DROP TABLE "Order"; --` en descripción/notas → texto normal, sin error 500, y el
  módulo sigue funcionando después.
- **E-19 Multi-tenant** → si tienes acceso a otra empresa: cambia de empresa y verifica que
  NO ves los documentos de Tecnología y Suministros Andina, ni puedes aprobar/convertir los
  suyos, ni vincular productos de inventario de otra empresa. Fuga = CRÍTICO.
- **E-20 Roles** → si dispones de cuentas con rol ADMINISTRATIVE y/o VIEWER:
  - VIEWER: no debe poder crear/aprobar/convertir/clonar.
  - ADMINISTRATIVE: puede crear/clonar; aprobar y convertir deben estar bloqueados.

---

## CIERRE DE PARTE 2B — ACTA (TEXTO)

```
ACTA PARTE 2B — [fecha]
[Pega debajo el ACTA PARTE 2A recibida, sin modificarla]
E-17..E-20: [prueba | comportamiento | ¿correcto? | evidencia]
Hallazgos nuevos: [solo si los hubo]
```

**El usuario copiará esta ACTA en la sesión de la Parte 3 (integración + informe final).**

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Rate limiter → espera 1 minuto. "Servicio temporalmente no disponible" en todas las
  mutaciones → infra local (Redis): prerequisito de entorno, detén la sesión.
