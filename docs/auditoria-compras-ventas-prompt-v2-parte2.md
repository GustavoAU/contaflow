# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 2A de 4)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> La Parte 2 original (E-1..E-20 en una sesión) superó el límite de contexto: el browser
> agrega un snapshot de página por CADA acción, así que el costo real son las navegaciones,
> no las capturas. Se divide en **2A (esta): máquina de estados + efecto fiscal** y
> **2B: seguridad/roles** (archivo `...parte2b.md`). Además, las pruebas ya verificadas en
> ciclos anteriores NO se re-corren (ver tabla más abajo).
> Secuencia completa: 1 → 2A → 2B → 3.

---

## 🪫 PRESUPUESTO DE ACCIONES (OBLIGATORIO — dos sesiones anteriores murieron por contexto)

- Haz el **mínimo de navegaciones**: no revisites páginas, no abras detalles salvo para
  evidencia de un hallazgo, no vuelvas al dashboard entre pruebas.
- Captura pantalla SOLO para evidencia de hallazgos ⚠️/❌. Rechazos correctos → texto con el
  mensaje exacto entre comillas.
- **Válvula de escape**: si completaste tu bloque de pruebas — o si notas que la sesión se
  está alargando (muchas acciones acumuladas) — EMITE EL ACTA con lo cubierto y detente.
  Un acta parcial vale; una sesión muerta sin acta no.

## 📋 ACTA PARTE 1 (2026-07-14) — contexto heredado

Documentos disponibles:
- **COT-0004 → Aprobada** (sin convertir — úsala para E-9 si hiciera falta, ya cubierta)
- **PRE-0006 → Borrador** (clon) · PRE-0005 → Convertida
- **OV-0004 → Borrador** (también OC-0003, OV-0003 preexistentes en Borrador)
- **OV-0005 → Convertida** (factura F-2001) · **OC-0004 → Convertida** (factura F-3001)
- Facturas existentes: F-1001, F-1002, F-2001, F-3001
- Período contable abierto: julio 2026. Cuentas GL configuradas.
- Fixes H-1/H-2 y fechas acotadas: ✅ verificados en Parte 1.
- Hallazgos ya reportados en Parte 1 (NO los re-reportes, ya están en el expediente):
  fecha de asiento un día antes de la fecha de conversión (14/7 → 13/7) · conversión de
  OV-0005 no generó movimiento SALIDA de inventario pese a ítem vinculado (stock era 0).

## ✅ YA VERIFICADAS EN CICLOS ANTERIORES — NO RE-CORRER (cópialas al acta como "heredado ✅")

| Prueba | Resultado heredado |
|---|---|
| E-2 cantidad 0/negativa | ✅ "El valor debe ser superior o igual a 0,0001" |
| E-3 precio 0/negativo | ✅ "El valor debe ser superior o igual a 0,01" |
| E-4 cantidad > 999.999 | ✅ server-side "Cantidad excede el límite permitido" |
| E-5 más de 50 ítems | ✅ server-side "Máximo 50 items por cotización" |
| E-6 contraparte vacía | ✅ validación nativa requerida |
| E-8 aprobar cotización terminal | ✅ estados terminales solo ofrecen "Clonar" |
| E-9 convertir cotización no aprobada | ✅ bloqueado |

## 🔒 CAJA NEGRA + ANTI-FALSO-POSITIVO (resumen esencial)

- NO VES código ni BD — solo la UI en `localhost:3000`. Lo no observable → "no verificable
  desde la UI". Tras un error de una acción, **recarga la lista antes de concluir** el estado.
- Que el sistema **RECHACE** estas pruebas es lo CORRECTO — el hallazgo sería que las ACEPTARA.
- Fechas con año fuera de [1900, 2100] rechazadas = fix 2026-07 funcionando, no hallazgo.
- CRÍTICO = correlativo duplicado, doble conversión (dos facturas del mismo pedido), asiento
  descuadrado, total/IVA mal calculado, fuga entre empresas.
- Cada ⚠️/❌ con evidencia: qué hiciste, qué viste, por qué es problema.

## ROL Y CONTEXTO

**Daniela Quintero**, CPC 51.077, OWNER en **Tecnología y Suministros Andina C.A.**
`http://localhost:3000` → menú Operaciones → Compras y Ventas. Navega SIEMPRE por el menú.

---

## FASE 3-A — MÁQUINA DE ESTADOS Y EFECTO FISCAL. Documenta el mensaje EXACTO de cada rechazo.

- **E-1 Sin ítems** → intenta crear un documento sin ninguna línea (si el form trae 1 fila por
  defecto, intenta vaciarla/quitarla) → debe rechazar.
- **E-7 Total manipulado** → observa si la UI permite editar el total directamente. Si no lo
  permite, anota "no manipulable desde la UI" (correcto). Si lo permite, verifica que el
  servidor use el suyo.
- **E-10** Aprobar una orden ya Aprobada/Convertida (usa OV-0005 u OC-0004) → debe bloquear.
- **E-11** Convertir a Factura una orden en Borrador (usa OV-0004) → debe bloquear.
- **E-12 Doble conversión** → intenta convertir OTRA VEZ una orden ya Convertida (OV-0005) →
  debe bloquear. Confirma en Facturación que NO hay dos facturas del mismo pedido (CRÍTICO si
  las hay).
- **E-13** Editar documento en estado terminal → no debe permitir modificar ítems/totales.
- **E-14 Fecha fuera del período abierto** → aprueba OV-0004 (o crea una orden mínima de 1
  ítem) y conviértela con fecha de un mes SIN período abierto (ej. 2025) → observa si bloquea
  o acepta; mensaje exacto. *(A confirmar: la validación puede vivir en la capa de facturación.)*
- **E-15 Número de factura duplicado** → convertir una orden usando el número `F-2001` (ya
  existe) → debe bloquear. *Duplicado aceptado = CRÍTICO.*
- **E-16 RIF inválido** → crea una orden mínima con RIF malformado (ej. `X-99`) → apruébala →
  conviértela → observa si el RIF inválido llega a la factura. "A confirmar" si dudas.

---

## CIERRE DE PARTE 2A — ACTA (TEXTO, sin capturas)

```
ACTA PARTE 2A — [fecha]
Heredado: E-2..E-6, E-8, E-9 ✅ (ciclo v1) — sin re-correr
E-1, E-7, E-10..E-16: [prueba | comportamiento | ¿correcto? | mensaje exacto]
Hallazgos nuevos: [ref, severidad, evidencia — solo si los hubo]
Documentos residuales: [número → estado]
```

**El usuario copiará esta ACTA en la sesión de la Parte 2B.** No hagas las pruebas de
seguridad (E-17..E-20) ni integración en esta sesión.

---

## NOTAS PARA EL AGENTE BROWSER

- Menú siempre; 404 por URL tecleada NO es hallazgo.
- Rate limiter ("Demasiadas solicitudes") → espera 1 minuto, no es bug.
- "Servicio temporalmente no disponible" en TODAS las mutaciones → infraestructura local
  (Redis): repórtalo como prerequisito de entorno y detén la sesión.
