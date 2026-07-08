"use client";
// src/modules/vendors/components/CustomerForm.tsx
// P2 (audit 2026-07-05): formulario único de cliente (crear + editar) con
// React Hook Form + zodResolver contra el schema Zod del server (mismos
// mensajes, mismas transforms "" → undefined). Réplica del piloto VendorForm.
// Reemplaza los 16 useState de campos que vivían duplicados en CustomerList.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon } from "lucide-react";
import type { z } from "zod";
import { CreateCustomerSchema } from "../schemas/vendor.schemas";
import type { ContactGroupRow } from "../services/ContactGroupService";

// Derivado del schema del server con .pick() — omite solo `address` (este form
// no lo captura). NO define validaciones nuevas: mismos mensajes que el server.
export const CustomerFormSchema = CreateCustomerSchema.pick({
  name: true,
  rif: true,
  email: true,
  phone: true,
  code: true,
  groupId: true,
  category: true,
  notes: true,
});

export type CustomerFormInput = z.input<typeof CustomerFormSchema>;
export type CustomerFormOutput = z.output<typeof CustomerFormSchema>;

export const EMPTY_CUSTOMER_FORM: CustomerFormInput = {
  name: "",
  rif: "",
  email: "",
  phone: "",
  code: "",
  groupId: "",
  category: "REGULAR",
  notes: "",
};

type CustomerFormProps = {
  /** "create" = tarjeta esmeralda · "edit" = fila <tr> inline en la tabla */
  variant: "create" | "edit";
  defaultValues: CustomerFormInput;
  groups: ContactGroupRow[];
  isPending: boolean;
  submitLabel: string;
  /** Recibe los valores YA validados/transformados por el schema ("" → undefined). */
  onSubmit: (values: CustomerFormOutput) => void;
  onCancel: () => void;
  /** Solo variant="edit": replica el colSpan de la celda de acciones. */
  canWrite?: boolean;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-red-600 mt-0.5">
      {message}
    </p>
  );
}

export function CustomerForm({
  variant,
  defaultValues,
  groups,
  isPending,
  submitLabel,
  onSubmit,
  onCancel,
  canWrite,
}: CustomerFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CustomerFormInput, unknown, CustomerFormOutput>({
    resolver: zodResolver(CustomerFormSchema),
    defaultValues,
  });

  const nameValue = watch("name") ?? "";
  // Guard doble-submit — mismo criterio que antes: !name.trim() || isPending
  const submitDisabled = !nameValue.trim() || isPending;
  const submit = handleSubmit(onSubmit);
  const errId = (field: string) => `customer-${variant}-${field}-error`;

  // ── Variant "edit": fila inline dentro de la tabla ──────────────────────────
  if (variant === "edit") {
    return (
      <tr className="bg-emerald-50">
        <td className="px-3 py-2">
          <div className="flex flex-col gap-1">
            <input
              className="rounded border px-2 py-1 text-sm w-full min-w-35"
              placeholder="Nombre *"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? errId("name") : undefined}
              {...register("name")}
            />
            <FieldError id={errId("name")} message={errors.name?.message} />
            <div className="flex gap-1">
              <select
                className="flex-1 rounded border px-2 py-1 text-xs text-zinc-600"
                {...register("groupId")}
              >
                <option value="">Sin grupo</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <select
                className="w-24 rounded border px-2 py-1 text-xs text-zinc-600"
                {...register("category")}
              >
                <option value="LEAD">Lead</option>
                <option value="REGULAR">Regular</option>
                <option value="VIP">VIP</option>
              </select>
            </div>
            <textarea
              className="rounded border px-2 py-1 text-xs resize-none"
              placeholder="Notas…"
              rows={2}
              maxLength={2000}
              {...register("notes")}
            />
            <FieldError id={errId("notes")} message={errors.notes?.message} />
          </div>
        </td>
        <td className="px-3 py-2">
          <input
            className="rounded border px-2 py-1 text-sm w-full min-w-20"
            placeholder="C-001"
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? errId("code") : undefined}
            {...register("code")}
          />
          <FieldError id={errId("code")} message={errors.code?.message} />
        </td>
        <td className="px-3 py-2">
          <input
            className="rounded border px-2 py-1 text-sm w-full min-w-30"
            placeholder="J-12345678-9"
            aria-invalid={!!errors.rif}
            aria-describedby={errors.rif ? errId("rif") : undefined}
            {...register("rif")}
          />
          <FieldError id={errId("rif")} message={errors.rif?.message} />
        </td>
        <td className="px-3 py-2">
          <input
            className="rounded border px-2 py-1 text-sm w-full min-w-35"
            placeholder="email@ejemplo.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? errId("email") : undefined}
            {...register("email")}
          />
          <FieldError id={errId("email")} message={errors.email?.message} />
        </td>
        <td className="px-3 py-2">
          <input
            className="rounded border px-2 py-1 text-sm w-full min-w-25"
            placeholder="+58 412…"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? errId("phone") : undefined}
            {...register("phone")}
          />
          <FieldError id={errId("phone")} message={errors.phone?.message} />
        </td>
        <td className="px-3 py-2" colSpan={canWrite ? 2 : 1}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void submit()}
              disabled={submitDisabled}
              aria-busy={isPending}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              <CheckIcon className="h-3 w-3" />
              {isPending ? "Guardando…" : submitLabel}
            </button>
            <button
              onClick={onCancel}
              disabled={isPending}
              className="rounded border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  // ── Variant "create": tarjeta esmeralda ─────────────────────────────────────
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 space-y-3">
      <p className="text-sm font-medium text-emerald-800">Nuevo cliente</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Nombre *"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? errId("name") : undefined}
            {...register("name")}
          />
          <FieldError id={errId("name")} message={errors.name?.message} />
        </div>
        <div>
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="RIF (J-12345678-9)"
            aria-invalid={!!errors.rif}
            aria-describedby={errors.rif ? errId("rif") : undefined}
            {...register("rif")}
          />
          <FieldError id={errId("rif")} message={errors.rif?.message} />
        </div>
        <div>
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? errId("email") : undefined}
            {...register("email")}
          />
          <FieldError id={errId("email")} message={errors.email?.message} />
        </div>
        <div>
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Teléfono"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? errId("phone") : undefined}
            {...register("phone")}
          />
          <FieldError id={errId("phone")} message={errors.phone?.message} />
        </div>
        <div>
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Código (ej: C-001)"
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? errId("code") : undefined}
            {...register("code")}
          />
          <FieldError id={errId("code")} message={errors.code?.message} />
        </div>
        <div className="flex gap-2">
          <select
            className="flex-1 rounded border px-2 py-1.5 text-sm text-zinc-700"
            {...register("groupId")}
          >
            <option value="">Sin grupo</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select
            className="w-32 rounded border px-2 py-1.5 text-sm text-zinc-700"
            {...register("category")}
          >
            <option value="LEAD">Lead</option>
            <option value="REGULAR">Regular</option>
            <option value="VIP">VIP</option>
          </select>
        </div>
      </div>
      <div>
        <textarea
          className="w-full rounded border px-2 py-1.5 text-sm resize-none"
          placeholder="Notas (ej: requiere factura con retención ISLR)"
          rows={2}
          maxLength={2000}
          {...register("notes")}
        />
        <FieldError id={errId("notes")} message={errors.notes?.message} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={submitDisabled}
          aria-busy={isPending}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {isPending ? "Guardando…" : submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded border px-3 py-1 text-sm text-gray-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
