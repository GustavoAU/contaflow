// src/components/accounting/JournalEntryForm.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import Decimal from "decimal.js";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createTransactionAction } from "@/modules/accounting/actions/transaction.actions";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  name: string;
  code: string;
  type: string;
};

type Props = {
  companyId: string;
  userId: string;
  accounts: Account[];
};

// ─── Schema del formulario ────────────────────────────────────────────────────

const EntryRowSchema = z.object({
  accountId: z.string().min(1, "Selecciona una cuenta"),
  debit: z.string(),
  credit: z.string(),
});

const FormSchema = z.object({
  description: z.string().min(3, "Minimo 3 caracteres"),
  date: z.string().min(1, "La fecha es requerida"),
  reference: z.string().optional(),
  notes: z.string().optional(),
  type: z.enum(["DIARIO", "APERTURA", "AJUSTE", "CIERRE"]),
  entries: z.array(EntryRowSchema).min(2, "Minimo 2 lineas"),
});

type FormValues = z.infer<typeof FormSchema>;

// ─── Helper: parsear decimal seguro ──────────────────────────────────────────

function parseDecimal(val: string): Decimal {
  const cleaned = val.replace(/[^0-9.]/g, "");
  return cleaned ? new Decimal(cleaned) : new Decimal(0);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function JournalEntryForm({ companyId, userId, accounts }: Props) {
  "use no memo";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const today = new Date().toISOString().split("T")[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      description: "",
      date: today,
      reference: "",
      notes: "",
      type: "DIARIO",
      entries: [
        { accountId: "", debit: "", credit: "" },
        { accountId: "", debit: "", credit: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  // ─── Calcular totales en tiempo real ─────────────────────────────────────

  const entries = form.watch("entries");
  const totalDebit = entries.reduce((acc, e) => acc.plus(parseDecimal(e.debit)), new Decimal(0));
  const totalCredit = entries.reduce((acc, e) => acc.plus(parseDecimal(e.credit)), new Decimal(0));
  const difference = totalDebit.minus(totalCredit);
  const isBalanced = difference.isZero() && totalDebit.greaterThan(0);

  // ─── Manejar entrada exclusiva debito/credito ─────────────────────────────

  function handleDebitChange(index: number, value: string) {
    form.setValue(`entries.${index}.debit`, value);
    if (value && parseDecimal(value).greaterThan(0)) {
      form.setValue(`entries.${index}.credit`, "");
    }
  }

  function handleCreditChange(index: number, value: string) {
    form.setValue(`entries.${index}.credit`, value);
    if (value && parseDecimal(value).greaterThan(0)) {
      form.setValue(`entries.${index}.debit`, "");
    }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  function onSubmit(values: FormValues) {
    if (!isBalanced) {
      toast.error("El asiento no está balanceado. Diferencia: " + difference.toFixed(2));
      return;
    }

    startTransition(async () => {
      const result = await createTransactionAction({
        companyId,
        userId,
        description: values.description,
        date: new Date(values.date + "T12:00:00"),
        reference: values.reference || undefined,
        notes: values.notes || undefined,
        type: values.type,
        entries: values.entries.map((e) => ({
          accountId: e.accountId,
          debit: e.debit || "0",
          credit: e.credit || "0",
        })),
      });

      if (result.success) {
        toast.success(`Asiento ${result.data.number} creado correctamente`);
        router.push(`/company/${companyId}/transactions`);
      } else {
        toast.error(result.error);
      }
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nuevo Asiento Contable</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Todos los asientos son inmutables una vez contabilizados.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* ─── Encabezado del asiento ─────────────────────────────────── */}
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
              Encabezado
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Descripcion */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Descripcion</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Resumen Diario de Ventas N° 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Fecha */}
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Tipo */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="DIARIO">Diario</SelectItem>
                        <SelectItem value="APERTURA">Apertura</SelectItem>
                        <SelectItem value="AJUSTE">Ajuste</SelectItem>
                        <SelectItem value="CIERRE">Cierre</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Referencia */}
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Referencia <span className="text-muted-foreground">(opcional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Factura N° 001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Notas */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Notas <span className="text-muted-foreground">(opcional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Notas adicionales..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* ─── Lineas del asiento ─────────────────────────────────────── */}
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
              Asientos
            </h2>

            {/* Tabla de lineas */}
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 px-2">
                <span className="col-span-5 text-xs font-medium text-zinc-500">Cuenta</span>
                <span className="col-span-3 text-right text-xs font-medium text-zinc-500">
                  Debito
                </span>
                <span className="col-span-3 text-right text-xs font-medium text-zinc-500">
                  Haber
                </span>
                <span className="col-span-1" />
              </div>

              {/* Filas */}
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-12 items-start gap-2">
                  {/* Cuenta */}
                  <div className="col-span-5">
                    <FormField
                      control={form.control}
                      name={`entries.${index}.accountId`}
                      render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Seleccionar cuenta..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {accounts.map((account) => (
                                <SelectItem key={account.id} value={account.id}>
                                  {account.code} — {account.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Debito */}
                  <div className="col-span-3">
                    <FormField
                      control={form.control}
                      name={`entries.${index}.debit`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              className="h-9 text-right font-mono"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) => handleDebitChange(index, e.target.value)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Credito */}
                  <div className="col-span-3">
                    <FormField
                      control={form.control}
                      name={`entries.${index}.credit`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              className="h-9 text-right font-mono"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) => handleCreditChange(index, e.target.value)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Eliminar */}
                  <div className="col-span-1 flex justify-center pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fields.length > 2 && remove(index)}
                      disabled={fields.length <= 2}
                      className="h-9 w-9 p-0 text-zinc-400 hover:text-red-500"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Agregar linea */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ accountId: "", debit: "", credit: "" })}
              className="gap-2"
            >
              <PlusIcon className="h-4 w-4" />
              Agregar Linea
            </Button>

            {/* ─── Sub Totales (estilo Galac) ──────────────────────────── */}
            <div className="mt-4 border-t pt-4">
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5 flex items-center">
                  <span className="text-sm font-semibold">Sub Totales</span>
                </div>
                <div className="col-span-3 text-right">
                  <span className="font-mono text-sm font-semibold">{totalDebit.toFixed(2)}</span>
                </div>
                <div className="col-span-3 text-right">
                  <span className="font-mono text-sm font-semibold">{totalCredit.toFixed(2)}</span>
                </div>
                <div className="col-span-1" />
              </div>

              {/* Diferencia */}
              <div className="mt-2 grid grid-cols-12 gap-2">
                <div className="col-span-5 flex items-center gap-2">
                  {isBalanced ? (
                    <CheckCircle2Icon className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircleIcon className="h-4 w-4 text-amber-500" />
                  )}
                  <span
                    className={`text-sm font-semibold ${isBalanced ? "text-green-600" : "text-amber-600"}`}
                  >
                    Diferencia:
                  </span>
                </div>
                <div className="col-span-6 text-right">
                  <span
                    className={`font-mono text-sm font-bold ${isBalanced ? "text-green-600" : "text-amber-600"}`}
                  >
                    {difference.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Acciones ────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/company/${companyId}/transactions`)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !isBalanced}>
              {isPending ? "Contabilizando..." : "Contabilizar Asiento"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
