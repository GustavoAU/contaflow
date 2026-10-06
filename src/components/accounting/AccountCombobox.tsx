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

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { CheckIcon, ChevronsUpDownIcon, InfoIcon, XIcon } from "lucide-react";

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
  /**
   * Campos opcionales (D2): con una cuenta elegida (o un valor huérfano) aparece el botón «Quitar la
   * cuenta», que emite `onChange("")`. Vaciar el texto y salir NO limpia (RN-15): el botón es la única vía.
   */
  clearable?: boolean;
  /**
   * Las cuentas aún se están cargando (acción cliente): el campo queda deshabilitado, `aria-busy` y con
   * «Cargando cuentas…», en vez de decir «No hay cuentas disponibles» durante ese instante.
   */
  loading?: boolean;
};

const LOADING_MESSAGE = "Cargando cuentas…";
const DEFAULT_PLACEHOLDER = "Buscar por código o nombre…";
const NO_ACCOUNTS_MESSAGE = "No hay cuentas disponibles";
const MAX_QUERY_LENGTH = 64;
const CAP_NOTICE = "Mostrando las primeras 100. Escribe más para afinar.";
const CLEAR_LABEL = "Quitar la cuenta";

const EMPTY_RESULT: AccountSearchResult = { rows: [], matchCount: 0, truncated: false };

/**
 * D3: ¿el evento viene de un AccountCombobox con la lista (o el aviso de «sin coincidencias») visible?
 * Decide solo por `target` (nunca por un estado global). Lo usa `onEscapeKeyDown` del AlertDialog de
 * Radix: el primer Esc cierra solo la lista y el segundo cierra el diálogo. El disparador de Radix
 * Select también es role="combobox" con data-state="open", pero NO es un <input>.
 */
export function isAccountComboboxOpen(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    target.getAttribute("role") === "combobox" &&
    target.getAttribute("data-state") === "open"
  );
}

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
  clearable = false,
  loading = false,
}: AccountComboboxProps) {
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const optionDomId = (accountId: string) => `${uid}-option-${accountId}`;

  const [open, setOpen] = useState(false);
  // Texto que el usuario está tecleando. `null` = no está editando: el campo muestra la cuenta de
  // `value`, así un cambio externo (autoselección, reset del formulario) se refleja solo (RN-20).
  const [typed, setTyped] = useState<string | null>(null);
  const [storedActiveId, setStoredActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  // Al devolver el foco al campo tras «Quitar la cuenta» no se abre la lista (solo se evita perder el foco).
  const skipOpenOnFocus = useRef(false);

  const hasSelectable = useMemo(() => accounts.some((account) => account.isPostable), [accounts]);
  const isDisabled = disabled || loading || !hasSelectable;
  // D1: solo una cuenta de MOVIMIENTO presente en `accounts` cuenta como elegida. Un título o un id
  // ausente (configuración vieja) se ve como campo vacío e inválido; nunca se emite onChange por eso.
  const selected = useMemo(
    () => accounts.find((account) => account.id === value && account.isPostable),
    [accounts, value]
  );
  const selectedText = selected ? `${selected.code} — ${selected.name}` : "";
  const isOrphan = value !== "" && !selected;
  const invalid = ariaInvalid === true || isOrphan ? true : ariaInvalid;
  const showClear = clearable && value !== "" && !disabled;

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

  /** D2: vacía el valor. mousedown no roba el foco; si el foco estaba en el botón, vuelve al campo. */
  function clearValue() {
    const buttonHadFocus = document.activeElement === clearRef.current;
    onChange("");
    cancel();
    if (buttonHadFocus) {
      skipOpenOnFocus.current = true;
      try {
        inputRef.current?.focus();
      } finally {
        skipOpenOnFocus.current = false;
      }
    }
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
    if (isDisabled || skipOpenOnFocus.current) return;
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
        ref={inputRef}
        type="text"
        role="combobox"
        id={id}
        value={typed ?? selectedText}
        placeholder={loading ? LOADING_MESSAGE : hasSelectable ? placeholder : NO_ACCOUNTS_MESSAGE}
        aria-busy={loading || undefined}
        disabled={isDisabled}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid}
        aria-autocomplete="list"
        aria-expanded={hasList}
        aria-controls={hasList ? listboxId : undefined}
        aria-activedescendant={hasList ? activeDomId : undefined}
        data-state={isOpen ? "open" : "closed"}
        className={cn(showClear ? "pr-16 pointer-coarse:pr-18" : "pr-8", className)}
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
      {showClear && (
        // mousedown con preventDefault: pulsar el botón no le quita el foco al campo (si no, el blur
        // cerraría la lista antes del clic). Alcanzable con Tab; en táctil el área llega a 44 px.
        <button
          ref={clearRef}
          type="button"
          aria-label={CLEAR_LABEL}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-7 flex w-8 items-center justify-center rounded-md outline-none focus-visible:ring-3 pointer-coarse:right-8 pointer-coarse:w-11"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearValue}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      )}

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
