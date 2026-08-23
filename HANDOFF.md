# Handoff — sistema de botones y arreglos de UI

Contexto para el agente: no toques nada fuera de lo listado. Cada punto es
independiente y se puede mergear por separado. Los archivos citados son rutas
reales del repo (`GustavoAU/contaflow`, branch `main`).

La especificación visual está en `design/` como PNG:

- `design/2a-incongruencias.png` — las 11 incongruencias en tabla
- `design/1a-sistema-botones.png` — el sistema de botones
- `design/1c-tab-prestamos.png` — el tab Préstamos aplicado

Los puntos 6 y 10 no dependen de esas imágenes: el **Anexo** al final de este
documento tiene la especificación completa en texto (tabla de variante y tamaño
por contexto, orden de columnas, alineaciones, copy exacto).

---

## 0. Decisión que desbloquea todo lo demás

`src/app/globals.css` declara:

```css
--primary: oklch(0.205 0 0);   /* negro, chroma 0 */
```

Es el default de shadcn sin personalizar. Nadie usa `bg-primary` porque un botón
negro se ve mal, así que `EmptyState`, `NavigationCard`, `ModuleTabs` y
`SearchParamTabs` escriben `blue-600` a mano. Todo el desorden de color sale de
aquí.

### El brand es el morado

El logo, el badge «Propietario» y el item activo del sidebar ya son morados. El
azul era la fuga, no el brand. Y el morado gana también en contraste sobre blanco:

| Color | Hex | Contraste vs blanco |
| --- | --- | --- |
| indigo-600 | `#4f46e5` | **6,3:1** |
| violet-600 | `#7c3aed` | 5,7:1 |
| blue-600 | `#2563eb` | 5,1:1 |

Los tres pasan AA para texto normal (4,5:1). Se elige indigo-600 porque es el
morado que ya está en la UI y el que más contraste da.

**Cambio en `:root` de `globals.css`:**

```css
--primary: oklch(0.511 0.262 276.966);      /* indigo-600 #4f46e5 */
--primary-foreground: oklch(0.985 0 0);
--ring: oklch(0.511 0.262 276.966);         /* el anillo de foco hoy es gris neutro */
```

Y en `.dark`:

```css
--primary: oklch(0.673 0.182 276.935);      /* indigo-400 */
--primary-foreground: oklch(0.205 0 0);
--ring: oklch(0.673 0.182 276.935);
```

### Arrastre: las sombras azules del tema

Al cambiar el primario a morado, estos dos tokens quedan huérfanos en azul y hay
que moverlos también, o la barra de progreso y el logo del sidebar se vuelven el
nuevo choque de color:

```css
--shadow-blue-glow:     0 2px 8px rgb(79 70 229 / 0.3);
--shadow-progress-glow: 0 0 8px rgb(79 70 229 / 0.6), 0 0 3px rgb(79 70 229 / 0.8);
```

Renombrarlos a `--shadow-primary-glow` y `--shadow-progress-glow` mientras estás
ahí: el nombre «blue» es lo que va a hacer que alguien vuelva a meter azul dentro
de un año.

---

## 1. Purgar los azules literales

Depende del punto 0. Una vez `--primary` es el morado, estos literales azules son
lo que impide cambiar el brand desde un solo lugar.

**`src/components/ui/EmptyState.tsx`** — el CTA es un `<button>` y un `<a>`
crudos con clases propias: sin `focus-visible`, con alto distinto al de
`Button`, y el `<a>` recarga la página entera saltándose `PageTransition`.
Reemplazar las dos ramas por:

```tsx
{action && (
  <Button asChild={!!action.href} onClick={action.onClick}>
    {action.href ? (
      <Link href={action.href}>
        {action.Icon && <action.Icon />}
        {action.label}
      </Link>
    ) : (
      <>
        {action.Icon && <action.Icon />}
        {action.label}
      </>
    )}
  </Button>
)}
```

`Button` ya aplica `[&_svg]:size-4` y `gap-2`, así que quitar `className="w-4 h-4"`
del icono.

**`src/components/ui/NavigationCard.tsx`** — `text-blue-600` del spinner
→ `text-primary`.

**`src/components/ui/ModuleTabs.tsx`** y **`SearchParamTabs.tsx`** — ver punto 4.
Ojo: el default de esos componentes es `color="blue"`. Cambiarlo a `"violet"`, o
mejor, derivarlo del token primario.

---

## 2. `AlertDialogAction` confirma en color de acción positiva

**`src/components/ui/alert-dialog.tsx`**

```tsx
className={cn(buttonVariants(), className)}
```

Sin argumentos = variant `default`. Toda confirmación destructiva de la app sale
en el color primario salvo que quien la use recuerde pasar la clase a mano. Es el
bug más silencioso del set.

```tsx
function AlertDialogAction({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  VariantProps<typeof buttonVariants>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}
```

Importar `type VariantProps` de `class-variance-authority`. Después, auditar los
call sites: todo diálogo de borrado/anulación debe pasar `variant="destructive"`.

---

## 3. Dos sistemas de badge

**`src/components/ui/StatusBadge.tsx`** repite palabra por palabra las clases base
de `badge.tsx` (`inline-flex items-center rounded-full border px-2 py-0.5 text-xs
font-medium whitespace-nowrap`) y encima trae su propia paleta amber/emerald/zinc
hardcodeada. Resultado en producción: «Activo» del empleado sale verde y «Activo»
del préstamo sale azul en la misma pantalla.

Que `StatusBadge` componga `Badge` y solo aporte el mapa de estados + el punto:

```tsx
export function StatusBadge({ status, variant = "dot", className }: Props) {
  const cfg = BADGE[status as StatusKey] ?? { ...FALLBACK, label: status };
  return (
    <Badge variant="outline" className={cn(cfg.bg, cfg.text, cfg.border, "gap-1.5", className)}>
      {variant === "dot" && (
        <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} aria-hidden />
      )}
      {cfg.label}
    </Badge>
  );
}
```

Y que sea el único badge de estado de la app: cualquier `<Badge>` que hoy renderice
un estado de dominio debe pasar por aquí.

---

## 4. Faltan estados de nómina, y dos claves duplicadas

**`src/components/ui/StatusBadge.tsx`**

`StatusKey` no tiene estados de préstamo, así que un préstamo liquidado cae al
`FALLBACK` y renderiza `—`. Agregar:

```ts
LIQUIDATED: { label: "Liquidado", dot: "bg-blue-500",  text: "text-blue-800",  bg: "bg-blue-50",  border: "border-blue-200" },
OVERDUE:    { label: "En mora",   dot: "bg-red-500",   text: "text-red-800",   bg: "bg-red-50",   border: "border-red-200"  },
```

Además `UNPAID` y `PENDING` son dos claves con el mismo label «Pendiente» y los
mismos colores exactos. Fusionar en una, o diferenciar el label
(«Por cobrar» vs «Pendiente»).

Y decidir el eje de los estados terminados: hoy `CANCELLED` es zinc neutro
mientras `VOIDED` y `REJECTED` son rojos. Tres formas de decir «esto no siguió»
con dos colores. Propuesta: rojo = lo anuló una persona, gris = terminó sin
efecto por sí solo.

---

## 5. Dos componentes de tabs, y un badge que ignora su propio prop

**`ModuleTabs.tsx`** y **`SearchParamTabs.tsx`** tienen el mapa de color copiado
palabra por palabra, y ya divergieron: solo `SearchParamTabs` soporta `badge`.

Peor: ese badge es `bg-blue-100 text-blue-700` fijo, así que unos tabs con
`color="violet"` llevan un contador azul.

- Extraer el mapa a un módulo compartido.
- Derivar el color del badge del mismo prop `color`, no hardcodearlo.
- A mediano plazo, fusionar los dos componentes: la única diferencia real es de
  dónde sale el valor activo (`pathname` vs `searchParams`), y eso se resuelve
  con una prop.

---

## 6. `size="xs"` está por debajo del área táctil

**`src/components/ui/button.tsx`** — `xs: "h-6 … text-xs"` = 24px de alto. Es lo
que produjo el «Cancelar» diminuto del tab Préstamos: alguien lo usó para que
cupiera en el `p-2` de una celda de tabla.

No hay que borrarlo, hay que documentar cuándo NO usarlo. En filas de tabla el
patrón correcto es `ghost` `sm` (h-8) para la acción principal más `icon-sm` para
el menú. Ver sección 1c del diseño.

---

## 7. El tooltip de `MoneyBadge` se recorta

**`MoneyBadge.tsx`** posiciona el tooltip con `absolute bottom-full`, pero
**`table.tsx`** envuelve toda tabla en `<div className="relative w-full
overflow-x-auto">`. En la primera fila de cualquier tabla la tasa BCV queda
cortada por arriba.

Migrar a un Tooltip de Radix en portal (ya tienes `radix-ui` como dependencia
única), o detectar la primera fila y abrir hacia abajo.

---

## 8. `Card` pelea con las tablas

**`card.tsx`** pone `py-6 gap-6` en la raíz, así que toda tabla dentro de una
`Card` tiene que deshacerlo con `py-0 gap-0`. Cada call site lo deshace distinto
y de ahí salen los espacios verticales inconsistentes entre módulos.

Mover el padding vertical a `CardContent`, o exponer una variante `flush` para
contenido a sangre (tablas, listas).

---

## 9. Dos escalas tipográficas solapadas

`--text-9` a `--text-15` sí están declaradas en `@theme` de `globals.css`, no son
inventos. El problema es que conviven con `text-xs` (12px) y `text-sm` (14px), que
caen justo en medio del rango.

Regla: la escala numérica solo por debajo de 12px. De 12 en adelante, la estándar.
Un lint rule sobre `text-13` y `text-15` es suficiente para mantenerlo.

---

## 10. El tab Préstamos, aplicado

Sección **1c** del diseño. Cambios estructurales, más allá del color:

- Las acciones de la tabla van en el header de la Card, no en una banda vacía
  encima. Título + contador a la izquierda, `outline` + `default` a la derecha.
- La columna de acciones necesita su `<th>`. Hoy el botón flota a la derecha de
  ESTADO sin encabezado ni ancho reservado.
- «Cancelar» sale de la fila y entra a un `DropdownMenu` con `AlertDialog` de
  confirmación. La acción visible es «Ver detalle».
- MONTO, CUOTA y SALDO están vacías en producción — hay que conectarlas. Deben
  renderizar con `MoneyBadge` (`exchangeRate` incluido), no con texto plano.
- Copy en sentence case: «Solicitar préstamo», no «Solicitar Préstamo».
- Tres KPIs arriba: saldo pendiente, deducción del período, préstamos activos.
  Es la pregunta que el usuario trae al abrir el tab.
- «Portal del empleado» sube al header de la página. Es una acción del empleado,
  no del tab Préstamos, y el callout azul competía con el contenido real.

---

# Anexo — especificación exacta para los puntos 6 y 10

PNGs de referencia en `design/`: `1a-sistema-botones.png`,
`1c-tab-prestamos.png`, `2a-incongruencias.png`. Todo lo que sigue está en texto
para que no necesites la imagen.

Todos los valores están en tokens de tu propio `button.tsx` / `globals.css`. Donde
aparece un hex es porque hoy no hay token.

## A. Tabla de acciones por contexto (punto 6)

| Contexto | Variante | Tamaño | Notas |
| --- | --- | --- | --- |
| Acción principal de la página | `default` | `default` (h-9) | Una sola por pantalla |
| Acción secundaria en header | `outline` | `default` (h-9) | |
| Acción principal en fila de tabla | `ghost` | `sm` (h-8) | Nunca `xs` |
| Menú de fila | `ghost` | `icon-sm` (size-8) | Glifo `⋯`, `MoreHorizontal` de lucide |
| Confirmar en `AlertDialog` | `default` o `destructive` | `default` | Ver punto 2 |
| Chip / filtro | `secondary` | `sm` | |
| `xs` (h-6) | — | — | Solo elementos no interactivos |

El radio es `rounded-md` = **8px** en todos (`--radius` es `0.625rem` = 10px, y
`--radius-md` = `calc(var(--radius) - 2px)`). No lo declares por botón.

`Button` ya aporta `gap-2` y `[&_svg]:size-4`: no pases clases de tamaño al icono
ni pongas un `+` tipográfico en el label.

## B. Estructura del tab Préstamos (punto 10)

Orden vertical dentro del tab:

1. **Tres KPIs** en `grid-cols-3` con `gap-3.5`. Cada uno es una `Card`:
   label `text-11 text-zinc-400`, valor `text-2xl font-semibold tracking-tight`,
   nota `text-11 text-zinc-400`.
   - Saldo total pendiente → valor + equivalente en Bs. con la tasa BCV
   - Deducción del período → monto + porcentaje del salario mensual
   - Préstamos activos → conteo + cuota actual y fecha de vencimiento

2. **Card de la tabla**, con header propio:
   - Izquierda: `text-sm font-semibold` «Préstamos» + `<Badge variant="secondary">`
     con el conteo
   - Derecha: `flex gap-2` → `outline` «Importar saldos» + `default`
     «Solicitar préstamo»
   - El header lleva `border-b`; la tabla va a sangre (ver punto 8 sobre `Card`)

3. **Columnas**, en este orden y con esta alineación:

| Columna | Alineación | Contenido |
| --- | --- | --- |
| CONCEPTO | izquierda | Tipo de préstamo + línea secundaria (moneda, fecha, intereses) |
| MONTO | derecha | `MoneyBadge` con `exchangeRate` |
| CUOTAS | centro | «2 / 12» + barra de progreso de 4px |
| CUOTA | derecha | `MoneyBadge` sin equivalente |
| SALDO | derecha | `MoneyBadge` con `exchangeRate`, en `font-semibold` |
| ESTADO | izquierda | `StatusBadge` |
| ACCIONES | derecha | `ghost sm` «Ver detalle» + `ghost icon-sm` `⋯` |

   ACCIONES **necesita su `<th>`** aunque el label vaya visualmente oculto. Hoy el
   botón flota a la derecha de ESTADO sin encabezado ni ancho reservado.

   Si usas grid en vez de `<table>`, la definición de columnas necesita
   `column-gap` explícito: sin él, una columna alineada a la derecha seguida de
   una alineada a la izquierda pone las dos etiquetas en contacto («SALDOESTADO»).

4. **Menú `⋯`** — `DropdownMenu` con: Ver detalle · Ver plan de cuotas ·
   Descargar contrato · separador · **Cancelar préstamo** en
   `text-destructive`, que abre un `AlertDialog` cuyo Action va en
   `variant="destructive"`.

5. Fuera del tab: **«Portal del empleado»** sube al header de la página como
   `outline default`, junto al `StatusBadge` del empleado y un `⋯` con el resto
   de acciones del empleado. El callout azul de autoservicio se reduce a una
   línea de `text-xs text-zinc-500` con un enlace al final del tab.

## C. Copy

Sentence case en todo. Los labels de este tab:

- «Solicitar préstamo» (no «Solicitar Préstamo»)
- «Importar saldos» (no «Importar saldos anteriores» — la columna ya da contexto)
- «Ver detalle»
- «Cancelar préstamo» (nunca «Cancelar» solo: no dice qué se cancela, y se
  confunde con el botón de cerrar el diálogo)

## D. Estado vacío

Cuando el empleado no tiene préstamos, `EmptyState` con `illustration="list"`,
título «Sin préstamos registrados», descripción de una línea, y el CTA
«Solicitar préstamo» — que después del punto 1 ya es un `Button` real.
