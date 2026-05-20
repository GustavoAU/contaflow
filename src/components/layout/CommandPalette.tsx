"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";
import type { NavSection, NavItem } from "@/lib/nav-items";

// ─── Types ────────────────────────────────────────────────────────────────────

type FlatItem = {
  label: string;
  href: string;
  group: string;
  Icon: NavItem["icon"];
};

type Props = {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
  primary: NavItem[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose, sections, primary }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { navigate } = usePageTransition();

  // Flatten all items, deduplicated by href
  const allItems = useMemo<FlatItem[]>(() => {
    const seen = new Set<string>();
    const add = (item: NavItem, group: string): FlatItem | null => {
      if (seen.has(item.href) || item.comingSoon) return null;
      seen.add(item.href);
      return { label: item.label, href: item.href, group, Icon: item.icon };
    };
    return [
      ...primary.map(i => add(i, "Principal")).filter(Boolean) as FlatItem[],
      ...sections.flatMap(s => s.items.map(i => add(i, s.group)).filter(Boolean) as FlatItem[]),
    ];
  }, [sections, primary]);

  // Filtered + grouped for display
  const filtered = useMemo<FlatItem[]>(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(i =>
      i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)
    );
  }, [query, allItems]);

  const grouped = useMemo(() => {
    const result: Record<string, Array<FlatItem & { idx: number }>> = {};
    filtered.forEach((item, idx) => {
      if (!result[item.group]) result[item.group] = [];
      result[item.group]!.push({ ...item, idx });
    });
    return result;
  }, [filtered]);

  // Reset selection when filter changes
  useEffect(() => setSelectedIndex(0), [query]);

  // Auto-scroll selected item into view
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // rAF ensures the portal is in the DOM
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function goToItem(item: FlatItem) {
    onClose();
    navigate(item.href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden mx-4">

        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-zinc-700 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                const item = filtered[selectedIndex];
                if (item) goToItem(item);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Buscar módulo o acción..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 not-italic">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              Sin resultados para «{query}»
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  {group}
                </p>
                {items.map(item => (
                  <button
                    key={item.href}
                    type="button"
                    data-selected={item.idx === selectedIndex ? "true" : undefined}
                    onClick={() => goToItem(item)}
                    onMouseEnter={() => setSelectedIndex(item.idx)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors",
                      item.idx === selectedIndex
                        ? "bg-zinc-700 text-white"
                        : "text-zinc-300 hover:bg-zinc-800"
                    )}
                  >
                    <item.Icon className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.idx === selectedIndex && (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer hint bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-700 px-4 py-2 text-[10px] text-zinc-500">
          <span>
            <kbd className="rounded bg-zinc-700 px-1 py-0.5 font-mono not-italic">↑↓</kbd> navegar
          </span>
          <span>
            <kbd className="rounded bg-zinc-700 px-1 py-0.5 font-mono not-italic">↵</kbd> abrir
          </span>
          <span>
            <kbd className="rounded bg-zinc-700 px-1 py-0.5 font-mono not-italic">Esc</kbd> cerrar
          </span>
          <span className="ml-auto">
            <kbd className="rounded bg-zinc-700 px-1 py-0.5 font-mono not-italic">Ctrl+↵</kbd> guardar formulario
          </span>
        </div>
      </div>
    </div>
  );
}
