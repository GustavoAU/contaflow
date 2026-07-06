// Re-export del canónico (ADR-041) — fuente única en src/lib/action-errors.ts
export { toActionError } from "@/lib/action-errors";

// Alias local conservado por compatibilidad: las actions de exchange-rates ya
// usaban este nombre. La implementación canónica vive en src/lib/net-context.ts.
export { netContext as resolveIpUa } from "@/lib/net-context";
