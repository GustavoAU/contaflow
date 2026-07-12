# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 2 de 3)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> **PARTE 2 = Fase 3**: validaciones y controles (E-1 a E-20). Requiere haber corrido la
> Parte 1 (flujos felices). Partes: 1 = fases 0-2 · 2 = esta · 3 = integración + informe.

---

## 📋 ACTA DE LA PARTE ANTERIOR — PEGAR AQUÍ

```
[EL USUARIO PEGA AQUÍ EL ACTA DE PARTE 1 — documentos creados y sus estados]
```

Si el acta no indica documentos utilizables, créalos tú por el menú (no es hallazgo).

---

## 📸 ECONOMÍA DE CONTEXTO (OBLIGATORIA)

- Captura **SOLO** la evidencia de hallazgos ⚠️/❌. Un rechazo correcto se documenta EN TEXTO
  con el mensaje exacto entre comillas — SIN captura.
- No captures formularios vacíos, menús ni pantallas repetidas.

## 🔒 NATURALEZA: QA MANUAL DE CAJA NEGRA

**NO VES el código ni la BD.** Solo la UI en `localhost:3000`. PROHIBIDO afirmar detalles
internos. Lo no observable → "no verificable desde la UI". Tras un error de una acción,
**recarga la lista antes de concluir el estado** de un documento.

## ⚠️ ANTI-FALSO-POSITIVO (esencial para esta fase)

> Que el sistema **RECHACE** estas pruebas es lo CORRECTO. El hallazgo sería si las ACEPTARA.

- Pre-contables: cotización/orden sin asiento = correcto.
- Estados terminales bloqueados = correcto. Solo se convierte lo Aprobado.
- IVA 31% ausente del selector = intencional.
- ADMINISTRATIVE no puede aprobar/convertir = segregación correcta (COSO).
- Totales/fechas recalculados o rechazados server-side = control correcto.
- **Fechas**: año fuera de [1900, 2100] debe rechazarse ("Fecha inválida o fuera del rango
  permitido (1900–2100)") — es el fix del ciclo 2026-07 funcionando, NO un hallazgo.
- XSS: si `<script>` aparece literal sin ejecutarse = correcto (React escapa por defecto).
- CRÍTICO = duplicado de correlativo, doble conversión, asiento descuadrado, total/IVA mal
  calculado, fuga entre empresas. Rechazos correctos y UX no son CRÍTICOS.
- Cada ⚠️/❌ lleva evidencia (qué hiciste, qué viste, por qué es problema).

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, OWNER en **Tecnología y Suministros Andina C.A.**
`http://localhost:3000` → menú Operaciones → Compras y Ventas. Navega SIEMPRE por el menú.

---

## FASE 3 — VALIDACIONES (uso indebido). Documenta el mensaje EXACTO de cada rechazo.

### Documentos (cotización / orden)
- **E-1 Sin ítems** → intenta crear sin ninguna línea → debe rechazar ("al menos un ítem").
- **E-2 Cantidad cero o negativa** (`0`, `-5`) → debe rechazar.
- **E-3 Precio cero o negativo** → debe rechazar.
- **E-4 Cantidad absurda** (> 999.999) → debe rechazar.
- **E-5 Más de 50 ítems** → debe rechazar ("máximo 50").
- **E-6 Contraparte vacía** → debe rechazar.
- **E-7 Total manipulado** → si la UI permitiera un total distinto al de las líneas, el
  servidor debe usar el suyo. Solo es hallazgo si persiste un total ≠ Σ líneas.

### Máquina de estados
- **E-8** Aprobar una cotización Rechazada/Convertida → debe bloquear.
- **E-9** Convertir a Orden una cotización en Borrador → debe bloquear.
- **E-10** Aprobar una orden ya Aprobada/Convertida → debe bloquear.
- **E-11** Convertir a Factura una orden en Borrador → debe bloquear.
- **E-12 Doble conversión** → convierte una orden a factura e intenta convertir LA MISMA otra
  vez → debe bloquear. *Verifica que NO existan dos facturas del mismo pedido — eso sería CRÍTICO.*
- **E-13** Editar un documento en estado terminal → no debe permitir modificar ítems/totales.

### Efecto fiscal de la conversión
- **E-14 Fecha fuera del período abierto** → al convertir con fecha de período cerrado,
  observa si bloquea o acepta. Documenta el mensaje exacto. *(A confirmar: la validación
  puede vivir en la capa de facturación.)*
- **E-15 Número de factura duplicado** → convertir usando un número ya existente → debe
  bloquear. *Duplicado aceptado = CRÍTICO.*
- **E-16 RIF inválido** → cotización/orden con RIF malformado → conviértela y observa si el
  RIF inválido llega a un documento FISCAL. Documenta; "a confirmar" si no estás segura.

### Seguridad / robustez
- **E-17 XSS** → `<script>alert(1)</script>` en descripción/contraparte/notas → debe aparecer
  literal, sin ejecutarse.
- **E-18 Inyección SQL** → `'; DROP TABLE "Order"; --` en descripción/notas → texto normal,
  sin error 500.
- **E-19 Multi-tenant** → si tienes acceso a otra empresa: NO debes poder ver/aprobar/convertir
  documentos de otra empresa ni vincular inventario ajeno. Fuga = CRÍTICO.
- **E-20 Roles** → si puedes probar otros roles: VIEWER solo lectura; ADMINISTRATIVE crea/clona
  pero NO aprueba/convierte (bloqueado = correcto).

---

## CIERRE DE PARTE 2 — ACTA (genera esto como TEXTO al final)

```
ACTA PARTE 2 — [fecha]
[Pega debajo el ACTA PARTE 1 recibida, sin modificarla]
E-1..E-20: [tabla compacta: prueba | comportamiento | ¿correcto? | mensaje exacto]
Hallazgos nuevos: [ref, severidad, evidencia — solo si los hubo]
Documentos residuales creados en esta parte: [número → estado]
```

**El usuario copiará esta ACTA en la sesión de la Parte 3.** No hagas integración ni informe
final en esta sesión.

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Rate limiter ("Demasiadas solicitudes") → espera 1 minuto, no es bug.
- "Servicio temporalmente no disponible" en TODAS las mutaciones → infraestructura local
  (Redis): repórtalo como prerequisito de entorno y detén la sesión.
