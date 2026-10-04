// src/components/ui/money-input.tsx
"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { formatMoneyVE, normalizeMoneyInput, parseMoneyInput } from "@/lib/money-input";

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  /** Valor canónico ("1234.56") o "". */
  value: string;
  /** Recibe SIEMPRE el valor canónico, nunca el texto con separadores. */
  onValueChange: (canonical: string) => void;
  /** Admite "-" inicial (saldos que pueden estar en sobregiro). */
  allowNegative?: boolean;
  /** Decimales máximos (def. 2); los sobrantes se descartan al teclear. */
  decimals?: number;
  /** Renderiza un <input> crudo (sin estilos de shadcn) para formularios con clases propias. */
  bare?: boolean;
};

/**
 * Input de importes: al escribir acepta coma o punto decimal; al salir del campo
 * muestra el valor con separadores de miles ("20.000,00"). El estado del formulario
 * guarda la forma canónica, así que el servidor nunca ve "100,99".
 */
export function MoneyInput({
  value,
  onValueChange,
  onBlur,
  onFocus,
  allowNegative = false,
  decimals = 2,
  bare = false,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");

  const shown = focused ? text : value ? formatMoneyVE(parseMoneyInput(value)) : "";

  const Field = bare ? "input" : Input;

  return (
    <Field
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onFocus={(e) => {
        setText(value ? value.replace(".", ",") : "");
        setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value.replace(allowNegative ? /[^0-9.,-]/g : /[^0-9.,]/g, "");
        setText(next);
        onValueChange(normalizeMoneyInput(next, { allowNegative, decimals }));
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
