# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 3 de 4)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> **PARTE 3 = Fases 4 y 5**: integración con otros módulos + INFORME FINAL consolidado.
> Secuencia completa: 1 → 2A → 2B → 3. Requiere el ACTA de la Parte 2B (que encadena las
> anteriores).

---

## 📋 ACTAS DE LAS PARTES ANTERIORES — PEGAR AQUÍ

```
[EL USUARIO PEGA AQUÍ EL ACTA DE PARTE 2B — que encadena las de 2A y Parte 1]
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
  otra forma o pregunta al Asistente IA antes de concluir "no se graba". *(Nota: que la
  columna User-Agent no sea visible en la tabla ya está reportado como mejora — no lo
  re-reportes como hallazgo.)*
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
