"use client";

import { useState, useTransition } from "react";
import { PlusIcon, PencilIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  getAccountsAction,
  createAccountAction,
  updateAccountAction,
  getNextAccountCodeAction,
} from "@/modules/accounting/actions/account.actions";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AccountType = "ASSET" | "CONTRA_ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

type Account = {
  id: string;
  name: string;
  code: string;
  type: AccountType;
  description: string | null;
  isMonetary: boolean;
  isCurrent: boolean;
  companyId: string;
  createdAt: Date;
  updatedAt: Date;
};

const BALANCE_TYPES = new Set(["ASSET", "CONTRA_ASSET", "LIABILITY"]);

const AccountFormSchema = z.object({
  name: z.string().min(2, "Minimo 2 caracteres"),
  code: z.string().min(1, "El codigo es requerido"),
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  description: z.string().optional(),
  isMonetary: z.boolean(),
  isCurrent: z.boolean(),
});

type AccountFormValues = z.infer<typeof AccountFormSchema>;

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Contra-activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

const TYPE_BADGE_CLASS: Record<AccountType, string> = {
  ASSET: "bg-blue-100 text-blue-800 border-transparent",
  CONTRA_ASSET: "bg-gray-100 text-gray-600 border-transparent",
  LIABILITY: "bg-red-100 text-red-800 border-transparent",
  EQUITY: "bg-purple-100 text-purple-800 border-transparent",
  REVENUE: "bg-green-100 text-green-800 border-transparent",
  EXPENSE: "bg-orange-100 text-orange-800 border-transparent",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function AccountsTable({
  initialAccounts,
  companyId,
}: {
  initialAccounts: Account[];
  companyId: string;
}) {
  const [accounts, setAccounts] = useState<Account[]>(
    [...initialAccounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(AccountFormSchema),
    defaultValues: { name: "", code: "", type: "ASSET", description: "", isMonetary: false, isCurrent: false },
  });

  const loadAccounts = async () => {
    const result = await getAccountsAction(companyId);
    if (result.success) {
      setAccounts(
        [...(result.data as Account[])].sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true })
        )
      );
    } else {
      toast.error(result.error);
    }
  };

  async function openCreate() {
    setEditing(null);
    form.reset({ name: "", code: "", type: "ASSET", description: "", isMonetary: false, isCurrent: false });
    setDialogOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await getNextAccountCodeAction("ASSET", companyId);
    if (result.success) form.setValue("code", result.data.code);
  }

  function openEdit(account: Account) {
    setEditing(account);
    form.reset({
      name: account.name,
      code: account.code,
      type: account.type,
      description: account.description ?? "",
      isMonetary: account.isMonetary,
      isCurrent: account.isCurrent,
    });
    setDialogOpen(true);
  }

  async function handleTypeChange(type: string) {
    if (!editing) {
      const result = await getNextAccountCodeAction(type as AccountType, companyId);
      if (result.success) form.setValue("code", result.data.code);
    }
  }

  function onSubmit(values: AccountFormValues) {
    startTransition(async () => {
      const result = editing
        ? await updateAccountAction({ id: editing.id, ...values })
        : await createAccountAction({ ...values, companyId });

      if (result.success) {
        if (result.warning) {
          toast.warning(result.warning);
        } else {
          toast.success(
            editing ? "Cuenta actualizada correctamente" : "Cuenta creada correctamente"
          );
        }
        // Ítem 14: insert/update optimista en posición ordenada por código
        if (!editing) {
          const optimistic: Account = {
            id: result.data.id,
            name: values.name,
            code: values.code,
            type: values.type,
            description: values.description ?? null,
            isMonetary: values.isMonetary,
            isCurrent: values.isCurrent,
            companyId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          setAccounts((prev) =>
            [...prev, optimistic].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
          );
        } else {
          setAccounts((prev) =>
            prev
              .map((a) => (a.id === editing.id ? { ...a, ...values, updatedAt: new Date() } : a))
              .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
          );
        }
        setDialogOpen(false);
        await loadAccounts();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Plan de Cuentas</h2>
          <p className="text-muted-foreground text-sm">
            Administra las cuentas contables de tu empresa
          </p>
        </div>
        <Button onClick={() => void openCreate()} className="gap-2">
          <PlusIcon className="h-4 w-4" />
          Nueva Cuenta
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No hay cuentas registradas. Crea la primera.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Codigo</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descripcion</TableHead>
              <TableHead
                className="text-center cursor-help"
                title="Partida monetaria (VEN-NIF 3): Caja, Bancos, CxC, CxP. No se reexpresa por INPC."
              >
                Monetaria ⓘ
              </TableHead>
              <TableHead
                className="text-center cursor-help"
                title="Corriente (VEN-NIF BA-10 / IAS 1): realizable o exigible en ≤12 meses. Solo aplica a Activos y Pasivos."
              >
                Corriente ⓘ
              </TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-mono font-medium">{account.code}</TableCell>
                <TableCell>{account.name}</TableCell>
                <TableCell>
                  <Badge className={TYPE_BADGE_CLASS[account.type]}>{TYPE_LABELS[account.type]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">
                  {account.description ?? "—"}
                </TableCell>
                <TableCell className="text-center">
                  {account.isMonetary ? (
                    <Badge variant="secondary" className="text-xs">Monetaria</Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {BALANCE_TYPES.has(account.type) ? (
                    account.isCurrent ? (
                      <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">Corriente</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">No corriente</span>
                    )
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(account)}
                    className="gap-1"
                  >
                    <PencilIcon className="h-3 w-3" />
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Cuenta" : "Nueva Cuenta"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Cuenta</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        void handleTypeChange(value);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ASSET">Activo</SelectItem>
                        <SelectItem value="CONTRA_ASSET">Contra-activo (Dep. Acumulada)</SelectItem>
                        <SelectItem value="LIABILITY">Pasivo</SelectItem>
                        <SelectItem value="EQUITY">Patrimonio</SelectItem>
                        <SelectItem value="REVENUE">Ingreso</SelectItem>
                        <SelectItem value="EXPENSE">Gasto</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Codigo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 1105" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Caja General" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Descripcion <span className="text-muted-foreground">(opcional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Descripcion de la cuenta..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isMonetary"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3 rounded-lg border p-3">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      />
                    </FormControl>
                    <div className="space-y-0.5">
                      <FormLabel className="font-medium">Partida Monetaria (VEN-NIF 3)</FormLabel>
                      <p className="text-muted-foreground text-xs">
                        Marcar para Caja, Bancos, CxC, CxP y similares. Estas cuentas no se reexpresan
                        por inflación INPC — su efecto se registra como REPOMO.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              {BALANCE_TYPES.has(form.watch("type")) && (
                <FormField
                  control={form.control}
                  name="isCurrent"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start gap-3 rounded-lg border p-3">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300"
                        />
                      </FormControl>
                      <div className="space-y-0.5">
                        <FormLabel className="font-medium">Corriente (VEN-NIF BA-10 / IAS 1)</FormLabel>
                        <p className="text-muted-foreground text-xs">
                          Marcar si el activo se realizará o el pasivo se liquidará en ≤12 meses.
                          Afecta la clasificación en el Balance General.
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Guardando..." : editing ? "Guardar Cambios" : "Crear Cuenta"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
