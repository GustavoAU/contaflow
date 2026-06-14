# ContaFlow — UI Patterns Reference
# Versión 1.1 — 2026-06-13

## §1 SPACING SCALE
```
xs: 4px   | sm: 8px   | md: 16px  | lg: 24px
xl: 32px  | 2xl: 48px | 3xl: 64px
```
Component internal padding: sm/md
Card gap: md/lg | Section gap: lg/2xl | Page margins: xl/2xl

## §2 TYPOGRAPHY
```
text-xs: 12px  | text-sm: 14px  | text-base: 16px | text-lg: 18px
text-xl: 20px  | text-2xl: 24px | text-3xl: 30px
```
ACCOUNTING MINIMUMS: monetary values ≥16px, table headers ≥14px, form labels ≥14px

## §3 COLOR TOKENS (WCAG AA validated)

### Text colors — contrast on white
- gray-900 (#111827) = 16.1:1 ✓ → headers
- gray-700 (#374151) = 10.2:1 ✓ → body text
- gray-600 (#4B5563) = 8.1:1 ✓ → secondary/helper text
- ❌ gray-500 (#6B7280) = barely passes — AVOID
- ❌ gray-400 (#9CA3AF) = FAILS — NEVER for text

### Semantic (always icon + text, never color alone)
- success: emerald-600 | warning: amber-600 | danger: red-600 | info: sky-600

### Primary
- primary: #3B82F6 (blue-500) | primary-dark: #1E40AF (blue-800)

### Dark mode pairing
- bg-white dark:bg-gray-900 | text-gray-900 dark:text-white
- border-gray-300 dark:border-gray-700 | text-gray-600 dark:text-gray-400

## §4 PAGE TRANSITIONS — Three-Level Strategy

```
Level 1: <300ms  → no loader (instant feel)
Level 2: 300ms–1000ms → progress bar (fixed top, h-1, bg-primary, animate-pulse)
Level 3: >1000ms → full overlay (bg-white/80 backdrop-blur) + spinner + module name
```

> ⚠️ NOMBRES REALES EN EL REPO (no inventar otros — verificado 2026-06-13):
> - Hook: `usePageTransition` → vive en `src/components/layout/PageTransitionProvider.tsx`
>   (NO en `src/hooks/`). El provider `PageTransitionProvider` envuelve el dashboard.
> - Barra de progreso global: `PageTransitionBar` → `src/components/layout/PageTransitionBar.tsx`
>   (estilo NProgress, montada en el layout — NO existe `PageTransitionLoader`).
> - Skeletons de carga: `TablePageSkeleton` / `CardPageSkeleton` / `FormPageSkeleton`
>   en `src/components/ui/page-skeleton.tsx`. Se usan dentro de los `loading.tsx` de cada ruta.
>   (NO existe `DataTableSkeleton` ni un componente `LoadingSpinner` separado).
> - Estado vacío de listas: `EmptyState` → `src/components/ui/EmptyState.tsx`
>   (props: title, description, illustration `default|invoices|list`, action).

### Hook: usePageTransition  (src/components/layout/PageTransitionProvider.tsx)
```tsx
'use client'
import { useRouter } from 'next/navigation'
import { useTransition, useCallback } from 'react'

export function usePageTransition() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const push = useCallback((href: string) => {
    startTransition(() => { router.push(href) })
  }, [router])

  const replace = useCallback((href: string) => {
    startTransition(() => { router.replace(href) })
  }, [router])

  return { push, replace, isPending }
}
```

### Skeletons de ruta  (src/components/ui/page-skeleton.tsx)
Cada `loading.tsx` de ruta importa el skeleton que corresponda a su layout:
```tsx
// app/.../<ruta>/loading.tsx
import { TablePageSkeleton } from '@/components/ui/page-skeleton'
export default function Loading() { return <TablePageSkeleton rows={8} /> }
```
- `TablePageSkeleton({ rows })` → listas / tablas
- `CardPageSkeleton({ cards })` → dashboards con tarjetas
- `FormPageSkeleton({ fields })` → páginas de formulario

## §5 BREAKPOINTS (mobile-first)
```
xs: 0px (mobile — design here first)
sm: 640px | md: 768px (tablet) | lg: 1024px (desktop) | xl: 1280px | 2xl: 1536px
```
Touch targets minimum: h-11 w-11 (44px) on mobile

## §6 RESPONSIVE PATTERNS

### Table → Cards on mobile — ESTRATEGIA REAL (verificado 2026-06-13)

Dos enfoques según el tipo de tabla. **No reescribir tablas densas a cards.**

**A) Listas simples (Clientes, Proveedores, Órdenes, Cotizaciones) → apilan a tarjetas.**
Usar la utilidad CSS `stack-card-table` (definida en `src/app/globals.css`). Es presentacional:
no se duplica JSX, solo se agrega la clase al `<table>` y `data-label="Columna"` a cada `<td>`.
Por debajo de `lg` (1023.98px) cada fila se convierte en tarjeta y cada celda muestra su
etiqueta. Las celdas sin `data-label` (acciones) no muestran etiqueta.
```tsx
<table className="stack-card-table min-w-full ...">
  <thead>...</thead>
  <tbody>
    <tr>
      <td data-label="Cliente">{name}</td>
      <td data-label="RIF">{rif}</td>
      <td>{/* acciones — sin data-label */}</td>
    </tr>
  </tbody>
</table>
```

**B) Tablas contables densas (Libro Diario/Mayor, nómina, inventario, reportes) → scroll horizontal.**
Decisión 2026-06-01: preservar columnas alineadas importa más que apilar. Envolver SIEMPRE en
`overflow-x-auto` (el primitivo `@/components/ui/table` ya lo trae). Nunca `overflow-hidden`
alrededor de una tabla `min-w-full` (recorta en móvil).
```tsx
<div className="overflow-x-auto rounded-lg border">
  <table className="min-w-full ...">...</table>
</div>
```

### Navigation hamburger
```tsx
<button className="md:hidden" aria-label="Abrir menú" aria-expanded={open}>
  <Menu size={24} />
</button>
<nav className="hidden md:flex">...</nav>
```

### Grid responsive
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
```

## §7 ACCESSIBILITY PATTERNS

### Inputs — always explicit label
```tsx
// ❌ WRONG
<input placeholder="Nombre completo" />

// ✓ CORRECT
<label htmlFor="fullname" className="block text-sm font-semibold text-gray-900 mb-1">
  Nombre completo <span className="text-red-600">*</span>
</label>
<input id="fullname" type="text" aria-required="true" aria-describedby="fullname-error" />
{error && <p id="fullname-error" className="text-sm text-red-600 mt-1">{error.message}</p>}
```

### Icon-only buttons
```tsx
<button aria-label="Eliminar factura" className="h-11 w-11 flex items-center justify-center focus:ring-2 focus:ring-blue-500 focus:outline-none">
  <Trash size={20} />
</button>
```

### Status with color + icon + text
```tsx
// ❌ WRONG: color only
<span className="text-green-600">Activo</span>

// ✓ CORRECT: color + icon + text
<span className="flex items-center gap-1 text-emerald-600">
  <CheckCircle size={16} aria-hidden /> Activo
</span>
```

### Focus ring (all interactive elements)
```tsx
className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
```

## §8 MICROCOPY STANDARDS

### Buttons — specific action + object
```
❌ "Submit" "Go" "Click here"
✓ "Crear asiento" "Descargar reporte" "Guardar cambios" "Eliminar factura"

Destructive: explain consequence
✓ "Cerrar período contable" (not "Confirmar")
✓ "Cancelar pedido" (not "Aceptar")
```

### Error messages — specific + actionable
```
❌ "Error de validación"
✓ "El número de factura debe comenzar con INV- (ejemplo: INV-001)"

❌ "Campo requerido"
✓ "El RIF del proveedor es obligatorio. Formato: J-12345678-9"
```

### Success messages
```
❌ "¡Éxito!"
✓ "Asiento #2026-000028 creado correctamente"
✓ "Nómina de abril 2026 calculada. 3 empleados procesados."
```

## §9 LOADING STATES — Decision Matrix

| Situation | Pattern |
|-----------|---------|
| Page/module change | usePageTransition + PageTransitionLoader |
| Table data loading | DataTableSkeleton |
| Single button action | LoadingSpinner (sm) inline in button |
| Per-row table action | disabled={isRowLoading} + Loader2 in button |
| Form submit | isPending → button text "Guardando..." + disabled |
| Background action | Toast notification on complete |

Rule: **never block the entire UI for a partial operation**

## §10 ERROR PATTERNS

### Validation error (user input)
```tsx
<div className="bg-red-50 border border-red-200 rounded-md p-4">
  <p className="text-sm font-semibold text-red-700 mb-2">El formulario tiene {n} errores</p>
  <ul className="text-sm text-red-600 space-y-1">
    <li>• El email no es válido</li>
  </ul>
</div>
```

### API error with retry
```tsx
<div className="bg-red-50 border border-red-200 rounded-md p-4">
  <p className="text-sm font-semibold text-red-700 mb-1">No se guardaron los cambios</p>
  <p className="text-sm text-gray-700 mb-3">El servidor no respondió. Intenta de nuevo.</p>
  <button onClick={handleRetry}>Reintentar</button>
</div>
```

### Permission error
```tsx
<p className="text-sm text-red-600">
  Solo ADMIN o OWNER pueden realizar esta acción. Contacta a tu administrador.
</p>
```
