// src/components/accounting/AccountCombobox.tsx
"use client";

// SPEC-012 — selector de cuenta buscable (reemplaza al <Select> de lista larga).
//
// Patrón ARIA combobox con lista (APG): un <input role="combobox"> que conserva el foco todo el
// tiempo y apunta a la opción activa con aria-activedescendant. Los títulos (isPostable = false) se
// ven como encabezados sangrados por nivel y NUNCA son opciones: no tienen role="option" y ni el clic,
// ni Enter, ni Tab, ni las flechas los pueden elegir. La búsqueda es la función pura de
// `@/lib/account-search` (código por prefijo, nombre por «contiene», varias palabras con Y).
//
// Contrato idéntico al <Select> anterior (RN-17): recibe `value` (id de cuenta o "") y emite
// `onChange(accountId)`, así que sirve dentro de FormControl de react-hook-form.

import { useEffect, useId, useMemo, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { CheckIcon, ChevronsUpDownIcon, InfoIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  filterAccountsWithMeta,
  findExactCodeMatch,
  normalizeSearch,
  type AccountOption,
  type AccountRow,
  type AccountSearchResult,
} from "@/lib/account-search";

export type { AccountOption };

export type AccountComboboxProps = {
  /** Títulos Y cuentas de movimiento de la empresa; el componente decide qué es elegible por isPostable. */
  accounts: readonly AccountOption[];
  /** Id de una cuenta de movimiento, o "" si no hay ninguna elegida. */
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** FormControl de shadcn lo inyecta para enlazar el mensaje de error con el campo. */
  "aria-describedby"?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

const DEFAULT_PLACEHOLDER = "Buscar por código o nombre…";
const NO_ACCOUNTS_MESSAGE = "No hay cuentas disponibles";
const MAX_QUERY_LENGTH = 64;
const CAP_NOTICE = "Mostrando las primeras 100. Escribe más para afinar.";

const EMPTY_RESULT: AccountSearchResult = { rows: [], matchCount: 0, truncated: false };

/** Sangría por nivel del código: 1 segmento = margen base, y 0,75 rem más por cada nivel. */
function indentFor(depth: number): string {
  return `${0.5 + (Math.max(depth, 1) - 1) * 0.75}rem`;
}

/**
 * Opción activa: la guardada si sigue en la lista; si no, la inicial (RN-13). Sin consulta la inicial es
 * la cuenta ya elegida (así la lista abre posada sobre ella); con consulta, la cuenta cuyo código
 * coincide exactamente, y si no existe, la primera seleccionable.
 */
function resolveActiveId(
  selectableRows: readonly AccountRow[],
  stored: string | null,
  query: string,
  selectedId: string | undefined
): string | null {
  if (selectableRows.length === 0) return null;
  if (stored !== null && selectableRows.some((row) => row.option.id === stored)) return stored;
  if (normalizeSearch(query) === "") {
    const current = selectableRows.find((row) => row.option.id === selectedId);
    return (current ?? selectableRows[0]).option.id;
  }
  return (findExactCodeMatch(selectableRows, query) ?? selectableRows[0]).option.id;
}

export function AccountCombobox({
  accounts,
  value,
  onChange,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  className,
}: AccountComboboxProps) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const optionDomId = (accountId: string) => `${uid}-option-${accountId}`;

  const [open, setOpen] = useState(false);
  // Texto que el usuario está tecleando. `null` = no está editando: el campo muestra la cuenta de
  // `value`, así un cambio externo (autoselección, reset del formulario) se refleja solo (RN-20).
  const [typed, setTyped] = useState<string | null>(null);
  const [storedActiveId, setStoredActiveId] = useState<string | null>(null);

  const hasSelectable = useMemo(() => accounts.some((account) => account.isPostable), [accounts]);
  const isDisabled = disabled || !hasSelectable;
  const selected = useMemo(
    () => accounts.find((account) => account.id === value),
    [accounts, value]
  );
  const selectedText = selected ? `${selected.code} — ${selected.name}` : "";

  // La consulta NO se inicializa con el texto mostrado: al abrir sobre una cuenta ya elegida la
  // lista sale completa.
  const query = typed ?? "";
  const isOpen = open && !isDisabled;

  // Solo se calcula con la lista abierta: la grilla de asientos tiene una instancia por fila.
  const search = useMemo(
    () => (isOpen ? filterAccountsWithMeta(accounts, query) : EMPTY_RESULT),
    [isOpen, accounts, query]
  );
  const selectableRows = useMemo(() => search.rows.filter((row) => row.selectable), [search]);

  // aria-expanded="true" exige una lista real a la que apuntar: sin resultados no hay listbox y el
  // campo se declara colapsado (el aviso «No hay cuentas…» no es una lista).
  const hasList = isOpen && search.rows.length > 0;
  const activeId = hasList
    ? resolveActiveId(selectableRows, storedActiveId, query, selected?.id)
    : null;
  const activeDomId = activeId !== null ? optionDomId(activeId) : undefined;

  const count = selectableRows.length;
  const liveMessage = isOpen ? `${count} ${count === 1 ? "cuenta" : "cuentas"}` : "";

  // Mantiene visible la opción activa al navegar con el teclado (jsdom no implementa scrollIntoView).
  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeDomId]);

  // ─── Acciones ────────────────────────────────────────────────────────────────────────────────

  function commit(option: AccountOption) {
    onChange(option.id);
    setTyped(null);
    setStoredActiveId(null);
    setOpen(false);
  }

  /** Restaura el texto de la cuenta elegida (RN-15) y cierra, sin emitir nada. */
  function cancel() {
    setTyped(null);
    setStoredActiveId(null);
    setOpen(false);
  }

  function moveActive(delta: 1 | -1) {
    if (selectableRows.length === 0) return;
    const index = selectableRows.findIndex((row) => row.option.id === activeId);
    // ArrowDown/ArrowUp saltan los encabezados porque solo recorren las filas seleccionables.
    const next =
      index < 0
        ? delta > 0
          ? 0
          : selectableRows.length - 1
        : (index + delta + selectableRows.length) % selectableRows.length;
    setStoredActiveId(selectableRows[next].option.id);
  }

  // ─── Eventos del input ───────────────────────────────────────────────────────────────────────

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setTyped(event.target.value);
    setStoredActiveId(null);
    setOpen(true);
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    if (isDisabled) return;
    setOpen(true);
    // Con una cuenta elegida, seleccionar el texto hace que lo primero que se teclea lo reemplace.
    if (typed === null) event.currentTarget.select();
  }

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    if (isDisabled) return;
    setOpen(true);
    if (typed === null) event.currentTarget.select();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isDisabled || event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) {
          setStoredActiveId(null);
          setOpen(true);
        } else {
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        }
        return;

      case "Enter": {
        // Con la lista abierta Enter es del selector (elige la activa); si no, enviaría el formulario.
        if (!isOpen) return;
        event.preventDefault();
        const row = selectableRows.find((candidate) => candidate.option.id === activeId);
        if (row) commit(row.option);
        return;
      }

      case "Tab":
        // RN-14: el contador teclea el código y sigue con Tab. Solo elige si la consulta deja
        // EXACTAMENTE una cuenta de movimiento (aunque haya encabezados de contexto). Nunca cancela
        // el evento: el foco sigue su camino.
        if (isOpen && normalizeSearch(query) !== "" && selectableRows.length === 1) {
          commit(selectableRows[0].option);
        }
        return;

      case "Escape":
        if (!isOpen) return;
        event.preventDefault();
        cancel();
        return;

      default:
        return;
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full">
      <Input
        type="text"
        role="combobox"
        id={id}
        value={typed ?? selectedText}
        placeholder={hasSelectable ? placeholder : NO_ACCOUNTS_MESSAGE}
        disabled={isDisabled}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-autocomplete="list"
        aria-expanded={hasList}
        aria-controls={hasList ? listboxId : undefined}
        aria-activedescendant={hasList ? activeDomId : undefined}
        className={cn("pr-8", className)}
        onChange={handleChange}
        onFocus={handleFocus}
        onClick={handleClick}
        onBlur={cancel}
        onKeyDown={handleKeyDown}
      />
      <ChevronsUpDownIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
      />

      {/* Anuncia «{n} cuentas» al abrir y al filtrar; cuenta solo cuentas de movimiento (RN-11). */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </span>

      {isOpen && (
        // preventDefault en mousedown: el clic en una opción, un encabezado, el aviso o la barra de
        // desplazamiento no le quita el foco al input (si no, el blur cerraría la lista antes del clic).
        <div
          className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 flex w-full min-w-[min(20rem,90vw)] flex-col overflow-hidden rounded-md border shadow-md"
          onMouseDown={(event) => event.preventDefault()}
        >
          {hasList ? (
            <>
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Cuentas contables"
                className="max-h-72 overflow-y-auto p-1"
              >
                {search.rows.map((row, index) => {
                  const { option, depth } = row;

                  if (!row.selectable) {
                    // Título: encabezado de contexto. Sin role="option": no se ofrece como elegible.
                    return (
                      <li
                        key={option.id}
                        role="presentation"
                        data-depth={depth}
                        className={cn(
                          "cursor-default py-1 pr-2 text-sm font-semibold text-gray-700 select-none dark:text-gray-300",
                          depth === 1 &&
                            index > 0 &&
                            "mt-1 border-t border-gray-200 pt-2 dark:border-gray-700"
                        )}
                        style={{ paddingLeft: indentFor(depth) }}
                      >
                        <span className="tabular-nums">{option.code}</span>{" "}
                        <span>{option.name}</span>
                      </li>
                    );
                  }

                  const isActive = option.id === activeId;
                  return (
                    <li
                      key={option.id}
                      id={optionDomId(option.id)}
                      role="option"
                      aria-selected={isActive}
                      data-depth={depth}
                      className={cn(
                        // pointer-coarse: en pantallas táctiles la fila llega a 44 px de alto.
                        "flex cursor-pointer items-start gap-2 rounded-sm py-1.5 pr-2 text-sm text-gray-900 dark:text-gray-100 pointer-coarse:py-3",
                        isActive && "bg-accent text-accent-foreground"
                      )}
                      style={{ paddingLeft: indentFor(depth) }}
                      onClick={() => commit(option)}
                      onMouseMove={() => {
                        if (!isActive) setStoredActiveId(option.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 wrap-break-word">
                        <span className="tabular-nums">{option.code}</span>
                        {" — "}
                        <span>{option.name}</span>
                      </span>
                      {option.id === value && (
                        <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>

              {search.truncated && (
                <p className="flex items-center gap-2 border-t px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                  <InfoIcon aria-hidden="true" className="size-4 shrink-0 text-sky-600" />
                  {CAP_NOTICE}
                </p>
              )}
            </>
          ) : (
            <p className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
              No hay cuentas que coincidan con «{query.trim()}»
            </p>
          )}
        </div>
      )}
    </div>
  );
}
