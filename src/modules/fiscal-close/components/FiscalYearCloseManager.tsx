"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { closeFiscalYearAction, appropriateFiscalYearResultAction } from "../actions/fiscal-close.actions";
import type { FiscalYearCloseSummary } from "../services/FiscalYearCloseService";

type Props = {
  companyId: string;
  yearToClose: number;
  isConfigured: boolean;
  history: (FiscalYearCloseSummary & {
    totalRevenue: string;
    totalExpenses: string;
    netResult: string;
  })[];
};

export function FiscalYearCloseManager({ companyId, yearToClose, isConfigured, history }: Props) {
  const [isPendingClose, startClose] = useTransition();
  const [isPendingAppropriation, startAppropriation] = useTransition();
  const [localHistory, setLocalHistory] = useState(history);

  function handleClose() {
    startClose(async () => {
      const result = await closeFiscalYearAction({ companyId, year: yearToClose, closedBy: "" });
      if (result.success) {
        toast.success(
          `Ejercicio ${yearToClose} cerrado. Resultado neto: ${Number(result.data.netResult) >= 0 ? "+" : ""}${result.data.netResult} Bs.`
        );
        setLocalHistory((prev) => [
          {
            id: result.data.fiscalYearCloseId,
            year: yearToClose,
            closedAt: new Date(),
            closedBy: "",
            totalRevenue: result.data.totalRevenue,
            totalExpenses: result.data.totalExpenses,
            netResult: result.data.netResult,
            hasAppropriation: false,
          },
          ...prev,
        ]);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleAppropriation(year: number) {
    startAppropriation(async () => {
      const result = await appropriateFiscalYearResultAction({ companyId, year, approvedBy: "" });
      if (result.success) {
        toast.success(`Asiento de apropiación del ejercicio ${year} registrado.`);
        setLocalHistory((prev) =>
          prev.map((r) => (r.year === year ? { ...r, hasAppropriation: true } : r))
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  const alreadyClosed = localHistory.some((r) => r.year === yearToClose);

  return (
    <div className="space-y-6">
      {/* ── Cierre del ejercicio actual ────────────────────────────────────── */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Cierre de Ejercicio {yearToClose}</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Genera los asientos de cierre de cuentas de resultado (VEN-NIF).
              Esta operación es irreversible.
            </p>
          </div>
          {alreadyClosed ? (
            <Badge variant="secondary">Cerrado</Badge>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!isConfigured || isPendingClose}
                >
                  {isPendingClose ? "Cerrando..." : `Cerrar Ejercicio ${yearToClose}`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    ¿Cerrar el Ejercicio Económico {yearToClose}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta operación es <strong>irreversible</strong>. Se generarán los asientos de
                    cierre de todas las cuentas de ingresos y gastos del año {yearToClose}.
                    <br />
                    <br />
                    Después del cierre:
                    <ul className="mt-2 list-disc list-inside space-y-1 text-sm">
                      <li>No se podrán crear nuevos asientos para el año {yearToClose}</li>
                      <li>No se podrán registrar facturas ni retenciones con fecha en {yearToClose}</li>
                      <li>Los períodos del año {yearToClose} no se podrán reabrir</li>
                    </ul>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClose}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Sí, cerrar ejercicio {yearToClose}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {!isConfigured && !alreadyClosed && (
          <p className="text-destructive text-xs">
            ⚠ Configura las cuentas de cierre en &quot;Configuración Contable&quot; antes de continuar.
          </p>
        )}
      </div>

      {/* ── Historial de cierres ───────────────────────────────────────────── */}
      {localHistory.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Historial de Cierres</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ejercicio</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Gastos</TableHead>
                <TableHead className="text-right">Resultado Neto</TableHead>
                <TableHead>Apropiación</TableHead>
                <TableHead>Fecha Cierre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localHistory.map((record) => {
                const net = Number(record.netResult);
                return (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.year}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(record.totalRevenue).toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(record.totalExpenses).toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm font-semibold ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                    >
                      {net >= 0 ? "+" : ""}
                      {net.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {record.hasAppropriation ? (
                        <Badge variant="secondary">Registrada</Badge>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPendingAppropriation}
                            >
                              Registrar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Apropiación del Resultado — Ejercicio {record.year}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Se generará el asiento de transferencia del resultado del ejercicio{" "}
                                {record.year} a la cuenta de Utilidades Retenidas / Pérdidas Acumuladas.
                                Esta operación corresponde a la decisión de la Asamblea General Ordinaria
                                (AGO).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleAppropriation(record.year)}>
                                Confirmar apropiación
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {record.closedAt.toLocaleDateString("es-VE")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
