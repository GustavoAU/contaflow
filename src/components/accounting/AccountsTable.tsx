"use client";

import { useState, useTransition } from "react";
import { PlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { getNextAccountCodeAction } from "@/modules/accounting/actions/account.actions";

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
import { Input } from "@/components/ui/input";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  getAccountsAction,
  createAccountAction,
  updateAccountAction,
} from "@/modules/accounting/actions/account.actions";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

type Account = {
  id: string;
  name: string;
  code: string;
  type: AccountType;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Schema del formulario ────────────────────────────────────────────────────

const AccountFormSchema = z.object({
  name: z.string().min(2, "Minimo 2 caracteres"),
  code: z.string().min(1, "El codigo es requerido"),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  description: z.string().optional(),
});

type AccountFormValues = z.infer<typeof AccountFormSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

const TYPE_COLORS: Record<AccountType, "default" | "secondary" | "destructive" | "outline"> = {
  ASSET: "default",
  LIABILITY: "destructive",
  EQUITY: "secondary",
  REVENUE: "default",
  EXPENSE: "outline",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function AccountsTable({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(AccountFormSchema),
    defaultValues: {
      name: "",
      code: "",
      type: "ASSET",
      description: "",
    },
  });

  // Cargar cuentas al montar
  const loadAccounts = async () => {
    const result = await getAccountsAction();
    if (result.success) {
      setAccounts(result.data as Account[]);
    } else {
      toast.error(result.error);
    }
  };
  async function openCreate() {
    setEditing(null);
    form.reset({ name: "", code: "", type: "ASSET", description: "" });
    setDialogOpen(true);
    // Generar codigo para ASSET por defecto
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await getNextAccountCodeAction("ASSET");
    if (result.success) form.setValue("code", result.data.code);
  }

  function openEdit(account: Account) {
    setEditing(account);
    form.reset({
      name: account.name,
      code: account.code,
      type: account.type,
      description: account.description ?? "",
    });
    setDialogOpen(true);
  }

  async function handleTypeChange(type: string) {
    form.setValue("type", type as AccountFormValues["type"]);

    // Solo autocompletar si es cuenta nueva
    if (!editing) {
      const result = await getNextAccountCodeAction(
        type as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
      );
      if (result.success) {
        form.setValue("code", result.data.code);
      }
    }
  }

  function onSubmit(values: AccountFormValues) {
    startTransition(async () => {
      const result = editing
        ? await updateAccountAction({ id: editing.id, ...values })
        : await createAccountAction(values);

      if (result.success) {
        if (result.warning) {
          toast.warning(result.warning); // ← aviso amarillo
        } else {
          toast.success("Cuenta creada correctamente");
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
      {/* Encabezado */}
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

      {/* Tabla */}
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
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-mono font-medium">{account.code}</TableCell>
                <TableCell>{account.name}</TableCell>
                <TableCell>
                  <Badge variant={TYPE_COLORS[account.type]}>{TYPE_LABELS[account.type]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">
                  {account.description ?? "—"}
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

      {/* Dialog crear / editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Cuenta" : "Nueva Cuenta"}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Codigo */}
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

              {/* Nombre */}
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

              {/* Tipo */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Cuenta</FormLabel>
                    <FormControl>
                      <select
                        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                        {...field}
                        onChange={(e) => handleTypeChange(e.target.value)}
                      >
                        <option value="ASSET">Activo</option>
                        <option value="LIABILITY">Pasivo</option>
                        <option value="EQUITY">Patrimonio</option>
                        <option value="REVENUE">Ingreso</option>
                        <option value="EXPENSE">Gasto</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Descripcion */}
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

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Guardando..." : editing ? "Guardar Cambios" : "Crear Cuenta"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
