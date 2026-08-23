// @vitest-environment jsdom

// src/components/ui/alert-dialog.test.tsx
// Punto 2 del handoff de UI. AlertDialogAction llamaba buttonVariants() sin
// argumentos, asi que toda confirmacion — incluidas las de borrado y anulacion —
// salia en el color de accion positiva salvo que quien la usara recordara pasar
// la clase a mano. Es silencioso: no rompe nada, solo comunica lo contrario.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./alert-dialog";

function renderAction(props: React.ComponentProps<typeof AlertDialogAction>) {
  return render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>¿Confirmar?</AlertDialogTitle>
        <AlertDialogFooter>
          <AlertDialogAction {...props} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe("AlertDialogAction", () => {
  it("acepta variant=destructive", () => {
    renderAction({ variant: "destructive", children: "Anular factura" });
    const btn = screen.getByText("Anular factura");
    expect(btn.className).toContain("bg-destructive");
    expect(btn.className).not.toContain("bg-primary");
  });

  it("sigue siendo el color primario por defecto (confirmaciones positivas)", () => {
    renderAction({ children: "Restaurar borrador" });
    expect(screen.getByText("Restaurar borrador").className).toContain("bg-primary");
  });

  it("no filtra el prop variant al DOM", () => {
    renderAction({ variant: "destructive", children: "Anular" });
    expect(screen.getByText("Anular").getAttribute("variant")).toBeNull();
  });

  it("className del call site sigue ganando", () => {
    renderAction({ className: "w-full", children: "Confirmar" });
    expect(screen.getByText("Confirmar").className).toContain("w-full");
  });
});
