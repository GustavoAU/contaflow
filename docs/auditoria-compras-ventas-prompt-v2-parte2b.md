# Prompt — Auditoría Compras y Ventas · ContaFlow (v2 · PARTE 2B de 4)
### Para usar en: Claude Browser (claude.ai/new con herramienta de navegación web)
> **PARTE 2B = seguridad y roles** (E-17..E-20). Sesión corta y liviana.
> Secuencia completa: 1 → 2A → 2B → 3.

---

## 📋 ACTA DE LA PARTE 2A — PEGAR AQUÍ

```
[EL USUARIO PEGA AQUÍ EL ACTA DE PARTE 2A]
```

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
