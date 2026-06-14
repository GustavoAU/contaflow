import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ─── Inline SVG illustrations ─────────────────────────────────────────────────

function IllustrationEmpty() {
  return (
    <svg viewBox="0 0 200 160" fill="none" aria-hidden className="w-40 h-32">
      {/* desk */}
      <rect x="20" y="120" width="160" height="6" rx="3" fill="#e4e4e7" />
      {/* monitor base */}
      <rect x="92" y="110" width="16" height="12" rx="2" fill="#d4d4d8" />
      <rect x="80" y="118" width="40" height="4" rx="2" fill="#d4d4d8" />
      {/* monitor */}
      <rect x="50" y="50" width="100" height="64" rx="8" fill="#f4f4f5" stroke="#d4d4d8" strokeWidth="2" />
      <rect x="58" y="58" width="84" height="48" rx="4" fill="#fafafa" />
      {/* empty lines on screen */}
      <rect x="68" y="68" width="48" height="4" rx="2" fill="#e4e4e7" />
      <rect x="68" y="78" width="64" height="4" rx="2" fill="#e4e4e7" />
      <rect x="68" y="88" width="36" height="4" rx="2" fill="#e4e4e7" />
      {/* person left */}
      <circle cx="42" cy="70" r="12" fill="#dbeafe" />
      <rect x="30" y="84" width="24" height="30" rx="6" fill="#bfdbfe" />
      {/* person right */}
      <circle cx="158" cy="70" r="12" fill="#dcfce7" />
      <rect x="146" y="84" width="24" height="30" rx="6" fill="#bbf7d0" />
      {/* magnifier */}
      <circle cx="158" cy="68" r="7" stroke="#86efac" strokeWidth="2" fill="none" />
      <line x1="163" y1="73" x2="168" y2="78" stroke="#86efac" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IllustrationInvoices() {
  return (
    <svg viewBox="0 0 200 160" fill="none" aria-hidden className="w-40 h-32">
      <rect x="55" y="30" width="90" height="110" rx="8" fill="#f4f4f5" stroke="#e4e4e7" strokeWidth="2" />
      <rect x="65" y="48" width="70" height="5" rx="2.5" fill="#e4e4e7" />
      <rect x="65" y="60" width="50" height="4" rx="2" fill="#e4e4e7" />
      <rect x="65" y="70" width="60" height="4" rx="2" fill="#e4e4e7" />
      <rect x="65" y="80" width="40" height="4" rx="2" fill="#e4e4e7" />
      <rect x="65" y="100" width="70" height="12" rx="3" fill="#dbeafe" />
      <rect x="40" y="20" width="90" height="110" rx="8" fill="#fafafa" stroke="#e4e4e7" strokeWidth="2" />
      <rect x="50" y="38" width="70" height="5" rx="2.5" fill="#d4d4d8" />
      <rect x="50" y="50" width="50" height="4" rx="2" fill="#e4e4e7" />
      <rect x="50" y="60" width="60" height="4" rx="2" fill="#e4e4e7" />
      <rect x="50" y="70" width="40" height="4" rx="2" fill="#e4e4e7" />
      <rect x="50" y="90" width="70" height="12" rx="3" fill="#f0fdf4" stroke="#86efac" strokeWidth="1.5" />
      <text x="85" y="100" fill="#16a34a" fontSize="8" fontWeight="600" textAnchor="middle">vacío</text>
    </svg>
  );
}

function IllustrationList() {
  return (
    <svg viewBox="0 0 200 160" fill="none" aria-hidden className="w-40 h-32">
      <rect x="30" y="30" width="140" height="100" rx="8" fill="#fafafa" stroke="#e4e4e7" strokeWidth="2" />
      {[0, 1, 2].map(i => (
        <g key={i}>
          <circle cx="52" cy={56 + i * 28} r="10" fill="#e4e4e7" />
          <rect x="68" y={50 + i * 28} width="60" height="5" rx="2.5" fill="#e4e4e7" />
          <rect x="68" y={59 + i * 28} width="38" height="4" rx="2" fill="#f4f4f5" />
        </g>
      ))}
      <circle cx="145" cy={56} r="10" fill="#dbeafe" />
      <circle cx="145" cy={84} r="10" fill="#f4f4f5" />
      <circle cx="145" cy={112} r="10" fill="#f4f4f5" />
    </svg>
  );
}

const ILLUSTRATIONS = {
  default: IllustrationEmpty,
  invoices: IllustrationInvoices,
  list: IllustrationList,
} as const;

// ─── Props ────────────────────────────────────────────────────────────────────

type IllustrationKey = keyof typeof ILLUSTRATIONS;

type EmptyStateProps = {
  title: string;
  description?: string;
  illustration?: IllustrationKey;
  /** Primary CTA */
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
    Icon?: LucideIcon;
  };
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  illustration = "default",
  action,
  className,
}: EmptyStateProps) {
  const Illustration = ILLUSTRATIONS[illustration];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-14 px-6 text-center",
        className
      )}
    >
      <Illustration />

      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-700">{title}</p>
        {description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xs">{description}</p>
        )}
      </div>

      {action && (
        action.href ? (
          <a
            href={action.href}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            {action.Icon && <action.Icon className="w-4 h-4" />}
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            {action.Icon && <action.Icon className="w-4 h-4" />}
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
