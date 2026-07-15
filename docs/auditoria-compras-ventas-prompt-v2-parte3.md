# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 3 de 4)

### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)

> **PARTE 3 = Fases 4 y 5**: integración con otros módulos + INFORME FINAL consolidado.
> Secuencia completa: 1 → 2A → 2B → 3. Requiere el ACTA de la Parte 2B (que encadena las
> anteriores).

---

## 📋 ACTAS DE LAS PARTES ANTERIORES — PEGAR AQUÍ

```
ACTA PARTE 2B — 2026-07-15

[ACTA PARTE 2A recibida, sin modificar]

Heredado: E-2..E-6, E-8, E-9 ✅ (ciclo v1) — sin re-correr.
- E-1 Sin ítems: bloqueado (validación nativa; no se puede quitar la última fila). ✅
- E-7 Total manipulado: no manipulable desde la UI (total derivado). ✅
- E-10/E-11 Transiciones inválidas: bloqueadas por ocultamiento del control según estado. ✅
- E-12 Doble conversión: orden Convertida solo ofrece "Clonar"; un solo asiento FAC-F-2001. ✅
- E-13 Editar documento terminal: no existe acción de edición en la UI. ✅
- E-14 ⚠️ HALLAZGO: conversión con fecha 15/01/2025 (mes SIN período contable) fue ACEPTADA
  — factura F-9002 creada y asiento FAC-F-9002 "Contabilizado" con fecha 14/1/2025. No hay
  validación de período inexistente en la conversión (solo bloquea período CERRADO).
- E-15 Reportado como CRÍTICO en 2A, RECLASIFICADO tras verificación en código/BD: el
  duplicado observado fue VENTA F-2001 vs COMPRA F-2001. El número de una factura de COMPRA
  pertenece al PROVEEDOR y puede coincidir legítimamente con la serie propia de venta. La
  unicidad real (verificada a nivel BD, índices parciales Fix A3): venta única por
  (empresa + número); compra única por (empresa + RIF proveedor + número). → Falso positivo
  por diseño. NO re-reportado en el informe final; registrado en "falsos positivos descartados".
- E-16 ⚠️ HALLAZGO: RIF malformado "X-99" aceptado en la orden (OC-0006) y PROPAGADO a la
  factura fiscal F-9003 y al Libro de Compras. La conversión no valida RIF antes de crear el
  documento fiscal.

Documentos residuales (2A): OV-0004 → Convertida (F-9002, fecha 14/1/2025) · OC-TESA-001 →
Convertida (F-2001 compra) · OC-0006 → Convertida (F-9003, RIF X-99) · sin cambios:
COT-0004 (Aprobada), PRE-0006 (Borrador), OC-0003/OV-0003 (Borrador), OV-TESA-001 (Aprobada).

---

E-17..E-20 (2026-07-15):

E-17 XSS | Se creó COT-0006 (Tecnología y Suministros Andina) con "<script>alert(1)</script>"
en Nombre de contraparte, descripción de ítem y notas | Correcto: el payload se renderiza
como texto literal en la tabla ("<script>alert(1)</script>" visible como string) sin ejecutar
ningún alert(). React escapa por defecto. | Evidencia: captura de pantalla de la fila COT-0006
mostrando el texto escapado.

E-18 SQLi | Se creó PRE-0007 con "'; DROP TABLE "Order"; --" en descripción de ítem y notas |
Correcto: el texto se guardó como cadena normal, sin error 500; el módulo Compras y Ventas
siguió funcionando con normalidad tras recargar la página (13 registros listados correctamente,
incluyendo el payload como texto plano). | Evidencia: recarga de página post-inserción sin
errores.

E-19 Multi-tenant | Se cambió de empresa (Tecnología y Suministros Andina → Clínica Santa
María, C.A., ambas con rol Propietario de la misma cuenta) | Correcto: Cotizaciones/Presupuestos
(0) y Órdenes de Compra y Venta (0) en Clínica Santa María — ningún documento de Tecnología y
Suministros Andina visible. Catálogo de productos (0) — sin fuga de inventario. Nota: el
formulario de ítems de cotización/orden usa descripción de texto libre, no un selector de
producto de inventario, por lo que el sub-caso "vincular productos de inventario de otra
empresa" no es aplicable (la función no existe en la UI). Sin fuga detectada.

E-20 Roles | Se dispone de cuentas con rol Administrador (Empresa Demo C.A.) bajo la misma
sesión; NO se dispone de cuenta VIEWER.
  - VIEWER: no ejecutable — prerequisito de cuentas faltante.
  - Administrador (rol visible en UI, correspondencia con "ADMINISTRATIVE" no verificable
    en código — caja negra): ❌ HALLAZGO CRÍTICO NUEVO. Con este rol se pudo:
    1) Crear una cotización de venta (PRE-0001, borrador ya existente) y aprobarla vía botón
       "Aprobar" (pasó a estado "Aprobada, Aprobado 15/7/2026") sin restricción.
    2) Crear una Orden de Compra nueva (OC-0002, Proveedor Test E-20), aprobarla vía botón
       "Aprobar" (pasó a "Aprobada"), y CONVERTIRLA A FACTURA (F-E20-001) vía el diálogo
       "Convertir OC-0002 a Factura", generando la factura y el asiento contable
       CMP-F-E20-001 con estado "Contabilizado" (11,60 Bs, fecha 14/7/2026).
    Según el criterio de la auditoría, el rol Administrador/ADMINISTRATIVE debería poder
    crear/clonar pero NO aprobar ni convertir (segregación de funciones COSO). Aquí SÍ pudo
    hacer ambas cosas sin ningún bloqueo ni mensaje de error, completando el ciclo hasta la
    contabilización. Esto es una carencia de control, no un falso positivo. | Evidencia:
    capturas de "Factura creada (ID: cmrlw4cb...)" y listado de Asientos mostrando
    CMP-F-E20-001 Contabilizado.

Hallazgos nuevos de esta sesión:
- E-20-NUEVO ❌ CRÍTICO: el rol "Administrador" (empresa Empresa Demo C.A.) no tiene bloqueada
  la aprobación ni la conversión a factura de cotizaciones/órdenes; pudo completar el ciclo
  completo (crear → aprobar → convertir → asiento Contabilizado) sin restricción de
  segregación de funciones.

Sin hallazgos nuevos en E-17, E-18, E-19.

── RECLASIFICACIÓN POST-ACTA (verificada contra código, 2026-07-15) ──
E-20-NUEVO: FALSO POSITIVO por confusión de etiquetas de rol. En la UI, "Administrador" es
el rol ADMIN — que por diseño SÍ puede aprobar y convertir (regla del sistema: "rol contable
o superior" = Propietario, Administrador y Contador). El rol operativo que NO debe poder
aprobar/convertir es "Administrativo" (ADMINISTRATIVE) — un rol DISTINTO, que no se probó
por falta de cuenta. Veredicto: la prueba ejercitó un rol permitido; el control de
segregación no fue violado. E-20 queda: Administrador ✅ correcto por diseño ·
Administrativo y VIEWER no ejecutables (prerequisito de cuentas faltante).
→ En el informe final va en la sección 9 (falsos positivos descartados), NO en hallazgos.
```

---

## 🪫 PRESUPUESTO DE ACCIONES (OBLIGATORIO — dos sesiones anteriores murieron por contexto)

- Mínimo de navegaciones; no revisites páginas. Captura **SOLO** evidencia de hallazgos ⚠️/❌
  y (opcional) UNA captura del asiento contable verificado. Todo lo demás EN TEXTO.
- Si la sesión se alarga antes de terminar la Fase 4, corta y emite el informe con lo cubierto,
  marcando lo no ejecutado como "pendiente" — un informe parcial vale más que una sesión muerta.

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código ni la BD.** Solo la UI en `localhost:3000`. PROHIBIDO afirmar detalles
internos. Lo no observable → "no verificable desde la UI".

## ⚠️ ANTI-FALSO-POSITIVO (esencial para esta fase)

- Cotizaciones/órdenes NO aparecen en Contabilidad (pre-contables) — correcto.
- Sin cuentas GL configuradas → factura sin asiento = degradación correcta.
- Ítems no vinculados al catálogo → sin movimiento de inventario = correcto.
- Documentos anulados/convertidos visibles en historial = trazabilidad correcta.
- Salto de correlativo tras un error ≠ bug; DUPLICADO sí es hallazgo (CRÍTICO) — PERO: el
  número de una factura de COMPRA es el del PROVEEDOR y puede coincidir con la serie propia
  de VENTA (unicidad real: venta por empresa+número; compra por empresa+RIF+número). El caso
  E-15 de la Parte 2A se reclasificó como falso positivo por diseño — va en la sección 9 del
  informe, no en hallazgos.
- Si la tabla de Auditoría no muestra un dato (ej. User-Agent), verifica si se puede ver de
  otra forma o pregunta al Asistente IA antes de concluir "no se graba". _(Nota: que la
  columna User-Agent no sea visible en la tabla ya está reportado como mejora — no lo
  re-reportes como hallazgo.)_
- **Roles**: "Administrador" (ADMIN) SÍ aprueba/convierte por diseño — el rol restringido es
  "Administrativo" (ADMINISTRATIVE). El E-20-NUEVO del acta 2B ya fue reclasificado como
  falso positivo (ver la reclasificación al final del acta) — en el informe va en sección 9.
- Cada ⚠️/❌ lleva evidencia.

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, OWNER en **Tecnología y Suministros Andina C.A.**
`http://localhost:3000` → menú lateral. Usa los documentos y facturas de las actas.

---

## FASE 4 — INTEGRACIÓN

- **4.1 Facturación**: las facturas convertidas (números en las actas) aparecen con número,
  contraparte, total e IVA correctos, vinculadas a su orden de origen.
- **4.2 Contabilidad (Diario/Mayor)**: asiento de cada factura convertida — dirección correcta
  (venta: Dr CxC / Cr Ventas / Cr IVA DF · compra: Dr Inventario / Dr IVA CF / Cr CxP),
  Σ(débitos)=Σ(créditos). Cotizaciones/órdenes NO deben aparecer.
- **4.3 Inventario**: para ítems vinculados al catálogo — movimiento (SALIDA venta / ENTRADA
  compra), stock y costo promedio ajustados.
- **4.4 Correlativos**: con todos los documentos creados en las 3 partes, confirma series
  consecutivas y SIN duplicados (COT/PRE/OC/OV).
- **4.5 Auditoría**: crear/aprobar/rechazar/convertir quedan en el log con usuario, fecha/hora
  e IP.
- **4.6 Dashboard/alertas**: ¿widget de órdenes por aprobar / cotizaciones por vencer, si aplica?

## FASE 5 — INFORME FINAL CONSOLIDADO

Consolida TODO (actas de Partes 1-2 + esta sesión) en este formato:

```
INFORME DE AUDITORÍA OPERATIVA — MÓDULO COMPRAS Y VENTAS (v2, 3 sesiones)
ContaFlow | Tecnología y Suministros Andina C.A.
Fecha: [hoy] | Auditora: Daniela Quintero, CPC 51.077

1. RESUMEN EJECUTIVO
2. RECONOCIMIENTO (Parte 1): [secciones, estados, correlativos, prerrequisitos]
3. FUNCIONALIDADES EVALUADAS
   Flujo                            | ✅/⚠️/❌ | Observación
   Crear cotización (Venta/Compra)  |          |
   Enviar / Aprobar / Rechazar      |          |
   Convertir cotización → Orden     |          |  ← incluye verificación fix H-1/H-2
   Crear / Aprobar Orden            |          |
   Convertir Orden → Factura        |          |
   Clonar                           |          |
   Asiento + Inventario al facturar |          |
   Fechas acotadas (fix 2026-07)    |          |
4. VALIDACIONES Y CONTROLES (E-1…E-20) [de la ACTA PARTE 2]
5. INTEGRACIÓN [4.1–4.6 de esta sesión]
6. CUMPLIMIENTO VEN-NIF / SENIAT / IVA
7. HALLAZGOS (solo con evidencia + severidad calibrada)
8. RECOMENDACIONES
9. FALSOS POSITIVOS DESCARTADOS / DISEÑO CORRECTO VERIFICADO
10. CONCLUSIÓN [listo / requiere ajustes / no listo]
```

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Facturación/Contabilidad/Inventario se visitan como verificación de integración — un
  problema propio de esos módulos va como "fuera de alcance".
- Rate limiter → espera 1 minuto. "Servicio temporalmente no disponible" en todas las
  mutaciones → infra local (Redis), prerequisito de entorno, detén la sesión.
