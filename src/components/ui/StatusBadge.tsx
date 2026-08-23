import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// ─── Definición centralizada de estados ──────────────────────────────────────
//
// Unico sistema de badge de estado de la app (punto 3 del handoff de UI):
// cualquier <Badge> que renderice un estado de dominio debe pasar por aqui.
//
// Eje de los estados terminados: ROJO = lo anulo/rechazo/cancelo una persona.
// GRIS = termino sin efecto por si solo (borrador, inactivo, periodo cerrado).

type StatusKey =
  // Invoice payment status
  | "UNPAID" | "PARTIAL" | "PAID" | "VOIDED"
  // Order / Quotation status
  | "DRAFT" | "APPROVED" | "CONVERTED" | "CANCELLED"
  | "PENDING_APPROVAL" | "REJECTED"
  // Asientos contables
  | "POSTED"
  // Períodos contables
  | "OPEN" | "CLOSED"
  // Préstamos de nómina
  | "LIQUIDATED" | "OVERDUE"
  // Genérico
  | "ACTIVE" | "INACTIVE" | "PENDING";

type BadgeConfig = { label: string; dot: string; text: string; bg: string; border: string };

const BADGE: Record<StatusKey, BadgeConfig> = {
  // ── Pago de facturas ──────────────────────────────────────────────────────
  UNPAID:           { label: "Por cobrar", dot: "bg-amber-400",    text: "text-amber-800",  bg: "bg-amber-50",   border: "border-amber-200" },
  PARTIAL:          { label: "Parcial",    dot: "bg-blue-400",     text: "text-blue-800",   bg: "bg-blue-50",    border: "border-blue-200"  },
  PAID:             { label: "Pagado",     dot: "bg-emerald-500",  text: "text-emerald-800",bg: "bg-emerald-50", border: "border-emerald-200"},
  VOIDED:           { label: "Anulado",    dot: "bg-red-400",      text: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"   },

  // ── Órdenes y Cotizaciones ────────────────────────────────────────────────
  DRAFT:            { label: "Borrador",   dot: "bg-zinc-400",     text: "text-zinc-600",   bg: "bg-zinc-100",   border: "border-zinc-200"  },
  PENDING_APPROVAL: { label: "En revisión",dot: "bg-amber-400",    text: "text-amber-800",  bg: "bg-amber-50",   border: "border-amber-200" },
  APPROVED:         { label: "Aprobada",   dot: "bg-emerald-500",  text: "text-emerald-800",bg: "bg-emerald-50", border: "border-emerald-200"},
  CONVERTED:        { label: "Convertida", dot: "bg-blue-500",     text: "text-blue-800",   bg: "bg-blue-50",    border: "border-blue-200"  },
  CANCELLED:        { label: "Cancelada",  dot: "bg-red-400",      text: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"   },
  REJECTED:         { label: "Rechazada",  dot: "bg-red-400",      text: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"   },

  // ── Períodos contables ────────────────────────────────────────────────────
  OPEN:             { label: "Abierto",    dot: "bg-emerald-500",  text: "text-emerald-800",bg: "bg-emerald-50", border: "border-emerald-200"},
  CLOSED:           { label: "Cerrado",    dot: "bg-zinc-400",     text: "text-zinc-500",   bg: "bg-zinc-100",   border: "border-zinc-200"  },

  // ── Préstamos de nómina ───────────────────────────────────────────────────
  LIQUIDATED:       { label: "Liquidado",  dot: "bg-blue-500",     text: "text-blue-800",   bg: "bg-blue-50",    border: "border-blue-200"  },
  OVERDUE:          { label: "En mora",    dot: "bg-red-500",      text: "text-red-800",    bg: "bg-red-50",     border: "border-red-200"   },

  // ── Asientos contables ────────────────────────────────────────────────────
  // VOIDED (arriba) cubre el asiento anulado.
  POSTED:           { label: "Contabilizado", dot: "bg-emerald-500", text: "text-emerald-800", bg: "bg-emerald-50", border: "border-emerald-200"},

  // ── Entidades (vendedores, clientes…) ─────────────────────────────────────
  ACTIVE:           { label: "Activo",     dot: "bg-emerald-500",  text: "text-emerald-800",bg: "bg-emerald-50", border: "border-emerald-200"},
  INACTIVE:         { label: "Inactivo",   dot: "bg-zinc-400",     text: "text-zinc-500",   bg: "bg-zinc-100",   border: "border-zinc-200"  },
  PENDING:          { label: "Pendiente",  dot: "bg-amber-400",    text: "text-amber-800",  bg: "bg-amber-50",   border: "border-amber-200" },
};

const FALLBACK: BadgeConfig = { label: "—", dot: "bg-zinc-300", text: "text-zinc-500", bg: "bg-zinc-50", border: "border-zinc-200" };

type Props = {
  status: string;
  /** "dot" = punto + texto (default); "pill" = solo texto con fondo */
  variant?: "dot" | "pill";
  className?: string;
};

export function StatusBadge({ status, variant = "dot", className }: Props) {
  const cfg = BADGE[status as StatusKey] ?? { ...FALLBACK, label: status };

  // Compone Badge en vez de repetir sus clases base palabra por palabra: este
  // componente solo aporta el mapa de estados y el punto de color.
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5", cfg.bg, cfg.text, cfg.border, className)}
    >
      {variant === "dot" && (
        <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} aria-hidden />
      )}
      {cfg.label}
    </Badge>
  );
}
