"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { PlusIcon, PencilIcon, Loader2Icon, Trash2Icon, FileSpreadsheetIcon } from "lucide-react";
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
  FormDescription,
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
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  getAccountsAction,
  createAccountAction,
  updateAccountAction,
  deleteAccountAction,
  getNextAccountCodeAction,
} from "@/modules/accounting/actions/account.actions";
import { checkParentTitle } from "@/modules/accounting/utils/parent-title";
import { MOVEMENT_CODE_REGEX, isPostableCode } from "@/lib/account-code";

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
  // false = título/subtítulo (< 9 dígitos, ADR-059): no se puede seleccionar en asientos.
  isPostable?: boolean;
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
  // SPEC-008: solo sirve para pedir la sugerencia de código en el alta; NO se envía al servidor
  // (el padre de una cuenta es el prefijo de su código, no una columna). "" = sin cuenta padre.
  parentId: z.string(),
});

type AccountFormValues = z.infer<typeof AccountFormSchema>;

const EMPTY_FORM: AccountFormValues = {
  name: "",
  code: "",
  type: "ASSET",
  description: "",
  isMonetary: false,
  isCurrent: false,
  parentId: "",
};

// Radix Select no admite `value=""` en un ítem: la opción "Sin cuenta padre" usa este centinela.
const NO_PARENT = "__no_parent__";

const compareByCode = (a: { code: string }, b: { code: string }) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

type CodeSuggestion = { parentId: string; ok: boolean };

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
  canImport = false,
}: {
  initialAccounts: Account[];
  companyId: string;
  /** OWNER/ADMIN/ACCOUNTANT — mismo nivel que crear cuenta a mano (ROLES.ACCOUNTING) */
  canImport?: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>(
    [...initialAccounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // SPEC-008: sugerencia de código al elegir el título padre. El estado de carga es explícito (no el
  // `isPending` de la transición) para que una respuesta obsoleta no deje el input bloqueado.
  const [, startSuggestion] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<CodeSuggestion | null>(null);
  // Contador de peticiones: solo la última respuesta se aplica (RN-8: es una propuesta, no una verdad).
  const suggestionRequestRef = useRef(0);

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(AccountFormSchema),
    defaultValues: EMPTY_FORM,
  });

  const watchedType = useWatch({ control: form.control, name: "type" });
  const watchedParentId = useWatch({ control: form.control, name: "parentId" });

  // RN-14: solo se ofrecen como padre los títulos de 6 dígitos del tipo elegido. La regla de
  // título/tipo es `checkParentTitle` (la misma del servidor); `.001` comprueba además que el título
  // tenga forma `A.B.CC.DD`, porque un `110101` sin puntos nunca produciría un código válido.
  const parentCandidates = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            a.isPostable === false &&
            MOVEMENT_CODE_REGEX.test(`${a.code}.001`) &&
            checkParentTitle({ code: a.code, type: a.type, isPostable: false }, watchedType) ===
              null
        )
        .sort(compareByCode),
    [accounts, watchedType]
  );
  const selectedParent = watchedParentId
    ? (accounts.find((a) => a.id === watchedParentId) ?? null)
    : null;

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

  // Invalida cualquier sugerencia en vuelo: su respuesta ya no corresponde al formulario actual.
  function cancelSuggestion() {
    suggestionRequestRef.current += 1;
    setIsSuggesting(false);
    setSuggestion(null);
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open) cancelSuggestion();
    setDialogOpen(open);
  }

  // SPEC-008: el alta arranca con el código vacío; la sugerencia llega al elegir el título padre.
  function openCreate() {
    cancelSuggestion();
    setEditing(null);
    form.reset(EMPTY_FORM);
    setDialogOpen(true);
  }

  // Al cambiar el tipo, el padre elegido y el código que salió de él dejan de valer (RN-3). En
  // edición no hay padre ni sugerencia: el código que ya tiene la cuenta no se toca.
  function handleTypeChange(value: AccountType, onChange: (value: AccountType) => void) {
    onChange(value);
    if (editing) return;
    cancelSuggestion();
    if (form.getValues("parentId")) {
      form.setValue("code", "");
      form.clearErrors("code");
    }
    form.setValue("parentId", "");
  }

  function handleParentChange(value: string, onChange: (value: string) => void) {
    const nextParentId = value === NO_PARENT ? "" : value;
    const hadParent = form.getValues("parentId") !== "";
    cancelSuggestion();
    const requestId = suggestionRequestRef.current;
    onChange(nextParentId);

    if (!nextParentId) {
      // Sin padre solo se crean títulos: el código que venía de un padre ya no aplica.
      if (hadParent) {
        form.setValue("code", "");
        form.clearErrors("code");
      }
      return;
    }

    setIsSuggesting(true);
    startSuggestion(async () => {
      const result = await getNextAccountCodeAction(watchedType, companyId, nextParentId);
      // Respuesta obsoleta: otra elección (o cambiar de tipo / cerrar el diálogo) ya la reemplazó.
      if (requestId !== suggestionRequestRef.current) return;
      setIsSuggesting(false);
      if (result.success) {
        form.setValue("code", result.data.code, { shouldValidate: true });
        setSuggestion({ parentId: nextParentId, ok: true });
      } else {
        // El código se deja como estaba; el usuario puede teclearlo o elegir otro título.
        toast.error(result.error);
        setSuggestion({ parentId: nextParentId, ok: false });
      }
    });
  }

  function handleDelete(account: Account) {
    // Confirmación explícita: quitar una cuenta cambia lo que se ve en todos los
    // desplegables de la aplicación.
    if (
      !window.confirm(
        `¿Eliminar la cuenta ${account.code} — ${account.name}?

` + "Si tiene asientos contables el sistema lo impedirá."
      )
    )
      return;

    setDeletingId(account.id);
    startTransition(async () => {
      const result = await deleteAccountAction(account.id);
      setDeletingId(null);
      if (result.success) {
        toast.success(`Cuenta ${account.code} eliminada`);
        // Mismo patrón que crear/editar: la tabla lleva su propio estado.
        setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      } else {
        toast.error(result.error);
      }
    });
  }

  function openEdit(account: Account) {
    cancelSuggestion();
    setEditing(account);
    form.reset({
      name: account.name,
      code: account.code,
      type: account.type,
      description: account.description ?? "",
      isMonetary: account.isMonetary,
      isCurrent: account.isCurrent,
      parentId: "",
    });
    setDialogOpen(true);
  }

  function onSubmit(values: AccountFormValues) {
    // `parentId` es solo de la UI (sugerencia de código): no viaja al servidor.
    const payload: Omit<AccountFormValues, "parentId"> = {
      name: values.name,
      code: values.code,
      type: values.type,
      description: values.description,
      isMonetary: values.isMonetary,
      isCurrent: values.isCurrent,
    };
    startTransition(async () => {
      const result = editing
        ? await updateAccountAction({ id: editing.id, ...payload })
        : await createAccountAction({ ...payload, companyId });

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
            name: payload.name,
            code: payload.code,
            type: payload.type,
            description: payload.description ?? null,
            isMonetary: payload.isMonetary,
            isCurrent: payload.isCurrent,
            isPostable: isPostableCode(payload.code),
            companyId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          setAccounts((prev) =>
            [...prev, optimistic].sort((a, b) =>
              a.code.localeCompare(b.code, undefined, { numeric: true })
            )
          );
        } else {
          setAccounts((prev) =>
            prev
              .map((a) => (a.id === editing.id ? { ...a, ...payload, updatedAt: new Date() } : a))
              .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
          );
        }
        // Guardar se bloquea mientras llega una sugerencia, y una respuesta antigua en vuelo se
        // descarta sola al llegar (el contador ya no coincide). Por eso aquí basta `setDialogOpen`:
        // `onSubmit` se pasa a `form.handleSubmit` durante el render y no debe tocar refs.
        setDialogOpen(false);
        await loadAccounts();
      } else {
        toast.error(result.error);
      }
    });
  }

  // Ayuda bajo el campo código (región aria-live): refleja el estado de la sugerencia (SPEC-008 §8).
  const parentLabel = selectedParent ? `${selectedParent.code} — ${selectedParent.name}` : "";
  let codeHelp: string;
  if (isSuggesting) {
    codeHelp = "Calculando el código sugerido…";
  } else if (selectedParent && suggestion?.parentId === selectedParent.id && suggestion.ok) {
    codeHelp = `Código sugerido dentro de ${parentLabel}. Puedes editarlo.`;
  } else if (selectedParent) {
    codeHelp = `No se pudo sugerir un código. Escríbelo dentro de ${parentLabel}.`;
  } else {
    codeHelp =
      "Sin cuenta padre solo puedes crear títulos (menos de 9 dígitos). Para una cuenta de movimiento elige un título padre.";
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
        <div className="flex items-center gap-2">
          {canImport && (
            <Button variant="outline" className="gap-2" asChild>
              <Link href={`/company/${companyId}/import/accounts`}>
                <FileSpreadsheetIcon className="h-4 w-4" />
                Importar Excel/CSV
              </Link>
            </Button>
          )}
          <Button onClick={() => openCreate()} className="gap-2">
            <PlusIcon className="h-4 w-4" />
            Nueva Cuenta
          </Button>
        </div>
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
                className="cursor-help text-center"
                title="Partida monetaria (VEN-NIF 3): Caja, Bancos, CxC, CxP. No se reexpresa por INPC."
              >
                Monetaria ⓘ
              </TableHead>
              <TableHead
                className="cursor-help text-center"
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
                <TableCell>
                  {account.name}
                  {account.isPostable === false && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      Título
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={TYPE_BADGE_CLASS[account.type]}>
                    {TYPE_LABELS[account.type]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">
                  {account.description ?? "—"}
                </TableCell>
                <TableCell className="text-center">
                  {account.isMonetary ? (
                    <Badge variant="secondary" className="text-xs">
                      Monetaria
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {BALANCE_TYPES.has(account.type) ? (
                    account.isCurrent ? (
                      <Badge variant="secondary" className="text-xs">
                        Corriente
                      </Badge>
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
                  {/* Sin esto, una cuenta creada por error se quedaba en el plan
                      para siempre, ensuciando todos los desplegables. El servidor
                      la rechaza si tiene asientos: eso no es un error que limpiar,
                      es historia contable. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(account)}
                    disabled={deletingId === account.id}
                    aria-busy={deletingId === account.id}
                    className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2Icon className="h-3 w-3" />
                    {deletingId === account.id ? "Eliminando…" : "Eliminar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
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
                      onValueChange={(value) =>
                        handleTypeChange(value as AccountType, field.onChange)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper" className="z-200">
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
              {/* SPEC-008: el alta de una cuenta de movimiento exige su título padre. En edición el
                  código ya existe y no se vuelve a sugerir. */}
              {!editing && (
                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cuenta padre (título)</FormLabel>
                      <Select
                        value={field.value || NO_PARENT}
                        onValueChange={(value) => handleParentChange(value, field.onChange)}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper" className="z-200">
                          <SelectItem value={NO_PARENT}>
                            Sin cuenta padre (crear un título)
                          </SelectItem>
                          {parentCandidates.map((parent) => (
                            <SelectItem key={parent.id} value={parent.id}>
                              {`${parent.code} — ${parent.name}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {parentCandidates.length === 0 && (
                        <FormDescription>
                          Aún no hay títulos de 6 dígitos para este tipo. Crea primero el título.
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Codigo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ej: 1.1.01.01.001 (9 dígitos = cuenta de movimiento)"
                        {...field}
                        disabled={isSuggesting}
                        aria-busy={isSuggesting}
                      />
                    </FormControl>
                    {!editing && (
                      <FormDescription aria-live="polite" aria-atomic="true">
                        {codeHelp}
                      </FormDescription>
                    )}
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
                        Marcar para Caja, Bancos, CxC, CxP y similares. Estas cuentas no se
                        reexpresan por inflación INPC — su efecto se registra como REPOMO.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              {BALANCE_TYPES.has(watchedType) && (
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
                        <FormLabel className="font-medium">
                          Corriente (VEN-NIF BA-10 / IAS 1)
                        </FormLabel>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Cancelar
                </Button>
                {/* Mientras llega la sugerencia el código aún no es el definitivo: no se puede guardar. */}
                <Button
                  type="submit"
                  disabled={isPending || isSuggesting}
                  aria-busy={isPending}
                  className="gap-2"
                >
                  {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
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
