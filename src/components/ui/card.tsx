import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * `flush` — contenido a sangre (tablas, listas). Punto 8 del handoff de UI.
 *
 * La raíz mete `py-6 gap-6`, que es lo correcto para una tarjeta de texto y lo
 * incorrecto para una que envuelve una tabla: la tabla tiene que llegar a los
 * bordes y sus propias filas ya aportan el ritmo vertical. Sin esta variante
 * cada call site lo deshace a mano con `py-0 gap-0`, y cada uno lo deshace
 * distinto — de ahí salen los espacios inconsistentes entre módulos.
 */
function Card({
  className,
  flush = false,
  ...props
}: React.ComponentProps<"div"> & { flush?: boolean }) {
  return (
    <div
      data-slot="card"
      data-flush={flush || undefined}
      className={cn(
        "bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm",
        flush ? "gap-0 py-0 overflow-hidden" : "gap-6 py-6",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
