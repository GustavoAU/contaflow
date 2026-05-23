import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExchangeRateInfo = {
  foreignCurrency: string; // e.g. "USD" — the non-VES side
  rate: string;            // VES per 1 foreignCurrency unit, e.g. "515.180000"
  date: string | Date;
  source?: string;         // e.g. "BCV"
};

type Props = {
  amount: string | number;
  currency: string;               // "VES", "USD", "EUR", etc.
  exchangeRate?: ExchangeRateInfo; // omit when no rate available
  align?: "left" | "right";       // controls which edge the tooltip anchors to
  className?: string;
};

// ─── Config ───────────────────────────────────────────────────────────────────

const CURRENCY_BAR: Record<string, string> = {
  USD: "bg-blue-500",
  EUR: "bg-purple-500",
  VES: "bg-emerald-500",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  VES: "Bs. ",
  USD: "$ ",
  EUR: "€ ",
};

function barColor(currency: string): string {
  return CURRENCY_BAR[currency.toUpperCase()] ?? "bg-zinc-400";
}

function symbol(currency: string): string {
  return CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FMT = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtNum(n: number): string {
  return FMT.format(Math.abs(n));
}

function formatDate(d: string | Date): string {
  try {
    const iso = typeof d === "string" ? d : d.toISOString();
    const [y, m, day] = iso.split("T")[0]!.split("-").map(Number);
    return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  } catch {
    return String(d);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders a monetary amount with a 3 px currency-colour bar on the left.
 * When exchangeRate is provided:
 *   - Shows the equivalent in the other currency as a second line (always visible)
 *   - Shows a CSS-only tooltip (120 ms hover delay) with rate source and date
 *
 * Usage in a <td>:
 *   <MoneyBadge amount={row.totalVes} currency="VES"
 *     exchangeRate={{ foreignCurrency:"USD", rate:row.rate, date:row.rateDate }} />
 */
export function MoneyBadge({ amount, currency, exchangeRate, align = "right", className }: Props) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) {
    return <span className={cn("text-zinc-300", className)}>—</span>;
  }

  const sign = num < 0 ? "−" : "";
  const amountText = `${sign}${symbol(currency)}${fmtNum(num)}`;

  // Equivalent calculation — rate is always VES per 1 foreign unit
  let equivLine: string | null = null;
  let tooltipContent: React.ReactNode = null;

  if (exchangeRate) {
    const rateNum = parseFloat(exchangeRate.rate);
    const fc = exchangeRate.foreignCurrency.toUpperCase();
    const rateLabel = `1 ${fc} = Bs. ${fmtNum(rateNum)} (${exchangeRate.source ?? "BCV"} ${formatDate(exchangeRate.date)})`;

    const equiv =
      currency.toUpperCase() === "VES"
        ? `${symbol(fc)}${fmtNum(Math.abs(num) / rateNum)}`
        : `Bs. ${fmtNum(Math.abs(num) * rateNum)}`;

    equivLine = `≈ ${equiv}`;

    tooltipContent = (
      <>
        <p className="text-zinc-400 text-10 leading-none mb-0.5">Tasa aplicada</p>
        <p className="font-medium">{rateLabel}</p>
        <p className="text-zinc-400 text-10 leading-none mt-1.5 mb-0.5">Equivalente</p>
        <p className="font-medium">{equiv}</p>
      </>
    );
  }

  return (
    // Named group avoids conflicts when MoneyBadge is nested inside other group elements
    <span className={cn("group/mb relative inline-flex items-start gap-1.5 tabular-nums", className)}>
      {/* 3 px currency colour bar — mt-[3px] centers it with the first text line */}
      <span
        className={cn("mt-0.75 inline-block h-3.5 w-0.75 shrink-0 rounded-full", barColor(currency))}
        aria-hidden
      />

      {/* Amount + optional inline equivalent (Xero-style composite cell) */}
      <span className="inline-flex flex-col">
        <span className="font-mono whitespace-nowrap">{amountText}</span>
        {equivLine && (
          <span className="text-11 leading-none text-zinc-400 mt-0.5">{equivLine}</span>
        )}
      </span>

      {/* Tooltip — CSS-only, 120 ms delay on enter, instant on leave */}
      {tooltipContent && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 mb-2",
            align === "right" ? "right-0 bottom-full" : "left-0 bottom-full",
            "w-max max-w-70 rounded-lg bg-zinc-900 px-3 py-2",
            "text-11 leading-snug text-white shadow-xl",
            // Show after 120 ms on hover, hide instantly on mouse-out
            "opacity-0 transition-opacity duration-100",
            "group-hover/mb:opacity-100 group-hover/mb:delay-[120ms]"
          )}
        >
          {tooltipContent}
        </span>
      )}
    </span>
  );
}
