---
id: SPEC-003
titulo: Asociar etiquetas y nombres accesibles en los formularios fiscales
estado: BORRADOR
fecha: 2026-10-02
rama: feat/spec-003-a11y-labels
arbol: "[10]"
zonas: []
adrs: []
---

# Asociar etiquetas y nombres accesibles en los formularios fiscales

## 1. Problema
ContaFlow declara WCAG AA, pero los tests automáticos de la SPEC-002 (axe-core) encontraron en los formularios de mayor riesgo fiscal campos que un lector de pantalla no puede nombrar, ni un usuario de teclado activar con un clic en la etiqueta. Causa raíz verificada en `RetentionForm.tsx`: un `<label>` seguido de un `<input>` hermano, sin `id` en el campo ni `htmlFor` en la etiqueta. No hay un componente compartido roto: es un patrón repetido campo por campo.

Deuda registrada hoy con `expectKnownA11yDebt` (SPEC-002, `src/__tests__/a11y.ts`):

| Componente | Regla (impacto) | Nodos |
|---|---|---|
| `InvoiceForm` | `label` (critical) | 6 inputs: fecha, tasa de línea (readonly), monto de línea, monto/fecha de retención IVA, monto de retención ISLR |
| `InvoiceForm` | `select-name` (critical) | 4 selects (tipo/categoría, moneda, tipo de impuesto) |
| `RetentionForm` | `label` (critical) | 1 input (`invoiceDate`) |
| `RetentionForm` | `select-name` (critical) | 2 selects (tipo de retención, % retención IVA) |
| `PayrollRunForm` | `label` (critical) | 2 inputs `date` (inicio y fin del período) |
| `PeriodManager` (diálogo "Abrir primer ejercicio") | `button-name` (critical) | 1 `SelectTrigger` del año; además falta `Description`/`aria-describedby` en el `DialogContent` |
| `AccountsImporter` | `label` (critical) | 1 input file oculto — **posible falso positivo** (clase `hidden` de Tailwind; jsdom no carga estilos) |

Alcance real mayor: un barrido por texto (`<label` sin `htmlFor` en la misma línea) da una cota alta de 347 etiquetas en 57 de 72 archivos con `<label>`, pero **no es un conteo fiable** (una etiqueta que envuelve su campo es válida sin `htmlFor`, y el JSX multilínea engaña al grep). La cifra real solo la da axe sobre cada formulario.

## 2. Base legal / contable
Ninguna — decisión de producto/calidad (WCAG 2.1 AA: 1.3.1 Información y relaciones, 3.3.2 Etiquetas o instrucciones, 4.1.2 Nombre, función, valor).

## 3. Alcance
**Incluye (Fase 1 — una sola rama):**
- Corregir las violaciones de la tabla de la sección 1 en los 6 componentes, y cambiar en cada test `expectKnownA11yDebt` por `expectNoSeriousA11yViolations`.
- Confirmar o descartar el falso positivo de `AccountsImporter` en un navegador real; si se confirma, `aria-label` explícito en el input oculto.
- `aria-describedby`/`DialogDescription` en el diálogo de `PeriodManager`.

**No incluye (explícito):**
- Barrido de los ~50 formularios restantes: es la Fase 2 (otra spec, ver sección 11 PA-1).
- Contraste de color (`color-contrast` está desactivado en jsdom; se revisa con navegador/Lighthouse).
- Cambios visuales, de copy o de lógica fiscal.
- Rediseño de los componentes de `ui/` (`Select`, `Label`, `Input`).

## 4. Reglas de negocio
- RN-1: Todo `input`, `select` y `textarea` visible de los 6 componentes tiene nombre accesible: `<label htmlFor>` ↔ `id` único del campo, o `aria-label`/`aria-labelledby` cuando no hay etiqueta visible.
- RN-2: Los `id` se generan con `useId()` (no cadenas fijas), para que dos instancias del mismo formulario en pantalla no repitan `id`.
- RN-3: Un `SelectTrigger` (combobox) se nombra con `aria-labelledby` apuntando al `<label>` o con `aria-label`.
- RN-4: Ningún cambio altera el `name`, el valor ni el comportamiento de envío de los campos (los Server Actions leen por `name`).
- RN-5: Tras la corrección, los 6 tests a11y usan `expectNoSeriousA11yViolations` y pasan.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
No aplica. Sin cambios en services ni actions.

## 8. UI
- Componentes: `src/components/invoices/InvoiceForm.tsx` (+ `invoice-form/InvoiceHeaderFields.tsx` y los subcomponentes que rendericen los campos fallidos), `src/components/retentions/RetentionForm.tsx`, `src/modules/payroll/components/PayrollRunForm.tsx`, `src/components/accounting/PeriodManager.tsx`, `src/components/import/AccountsImporter.tsx`.
- Estados: sin cambio (vacío, cargando, error, éxito).
- Accesibilidad: es el objetivo de la spec. Además verificar a mano con teclado: clic en la etiqueta enfoca el campo; orden de foco intacto; `aria-busy` + `disabled={isPending}` en botones fiscales siguen presentes (Árbol [10]).
- Copy: sin cambios. No se reescribe ningún texto visible.

## 9. Criterios de aceptación
- [ ] CA-1: Los 6 archivos `*.a11y.test.tsx` usan `expectNoSeriousA11yViolations` en todos sus casos y pasan.
- [ ] CA-2: `grep -rn expectKnownA11yDebt src` no devuelve usos en los 6 componentes (la deuda se saldó).
- [ ] CA-3: Los tests existentes de esos componentes (`InvoiceForm.test.tsx`, etc.) siguen en verde sin editarlos (RN-4).
- [ ] CA-4: En un navegador real, clic sobre la etiqueta de cada campo corregido enfoca su campo.
- [ ] CA-5: Se documenta la decisión sobre el input oculto de `AccountsImporter` (falso positivo confirmado o corregido).
- [ ] CA-tenant / CA-período: no aplican (sin mutaciones nuevas).

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **PA-1 (usuario):** ¿Fase 2 — barrido de los demás formularios con axe? Propuesta: una spec aparte que renderice cada formulario con el mismo helper y corrija por lotes, empezando por los de mayor volumen (EmployeeForm, FixedAssetForm, PayrollWizard, PaymentForm, OrderForm, QuotationForm).
- **PA-2 (usuario):** ¿Prioridad frente al resto del backlog? No bloquea el lanzamiento, pero WCAG AA figura como declarado.
- **R-1:** muchos formularios usan `<input>` nativos con clases Tailwind en lugar del `Input` de `ui/`; los `id` con `useId` deben pasarse a ambos sin romper el estilo.
- **R-2:** un `htmlFor` mal apuntado deja el campo peor que antes (nombre incorrecto). Por eso CA-1 exige axe en verde y CA-4 una comprobación manual.
- **R-3:** la regla de la SPEC-002 R-2 ("si son muchas violaciones, otra spec") es la razón de que esto sea una spec propia y no parte de la 002.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
