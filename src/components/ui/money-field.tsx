// src/components/ui/money-field.tsx
"use client";

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { MoneyInput } from "@/components/ui/money-input";

type MoneyInputProps = React.ComponentProps<typeof MoneyInput>;

type Props<T extends FieldValues> = Omit<MoneyInputProps, "value" | "onValueChange" | "name"> & {
  control: Control<T>;
  name: Path<T>;
};

/**
 * Adaptador de react-hook-form para MoneyInput: el campo del formulario guarda el valor
 * canónico ("1234.56") y el usuario ve "1.234,56". Reemplaza a
 * `<input type="number" {...register(name)} />` en los campos de importe.
 */
export function MoneyField<T extends FieldValues>({ control, name, onBlur, ...rest }: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <MoneyInput
          {...rest}
          name={field.name}
          ref={field.ref}
          value={(field.value as string | undefined) ?? ""}
          onValueChange={field.onChange}
          onBlur={(e) => {
            field.onBlur();
            onBlur?.(e);
          }}
        />
      )}
    />
  );
}
