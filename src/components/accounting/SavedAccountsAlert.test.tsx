// @vitest-environment jsdom
// src/components/accounting/SavedAccountsAlert.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Todo lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase
// (único cambio permitido en el paso 2: sustituir el import dinámico por un import estático).
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — `SavedAccountsAlert` (contrato de la alerta de Q4):
//   props { problems: ReadonlyArray<{ key: string; label: string }> }
//   · sin problemas NO renderiza nada;
//   · con problemas, `role="alert"` que explica que esas configuraciones apuntan a una cuenta de TÍTULO
//     o que YA NO EXISTE, lista los rótulos y pide cambiarlas por una cuenta de MOVIMIENTO para poder
//     guardar.
//
// El texto exacto no está fijado: se comprueba lo que el contrato SÍ dice (título, ya no existe,
// movimiento, guardar y los rótulos, en el orden recibido). Es solo informativo: sin botones ni
// enlaces, y los rótulos se pintan como TEXTO (nunca como HTML).
//
// Modo RED: `./SavedAccountsAlert` aún no existe; se carga con un import dinámico de especificador no
// literal y se tipan sus props con el contrato, de modo que `tsc` no falle y cada caso falle por su
// propia razón. En GREEN se puede pasar a `import { SavedAccountsAlert } from "./SavedAccountsAlert"`.

import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { expectNoSeriousA11yViolations } from "@/__tests__/a11y";

type Problem = { key: string; label: string };
type SavedAccountsAlertProps = { problems: ReadonlyArray<Problem> };

const MODULE_PATH = "./SavedAccountsAlert";
async function loadAlert(): Promise<ComponentType<SavedAccountsAlertProps>> {
  const mod = (await import(/* @vite-ignore */ MODULE_PATH)) as {
    SavedAccountsAlert?: ComponentType<SavedAccountsAlertProps>;
  };
  if (typeof mod.SavedAccountsAlert !== "function") {
    throw new Error("SavedAccountsAlert no es una función exportada por ./SavedAccountsAlert");
  }
  return mod.SavedAccountsAlert;
}

afterEach(cleanup);

const P1: Problem = { key: "resultAccountId", label: "Cuenta Resultado del Ejercicio" };
const P2: Problem = { key: "retainedEarningsAccountId", label: "Cuenta Utilidades Retenidas" };
const P3: Problem = { key: "fxGainAccountId", label: "Ganancia Cambiaria" };

async function renderAlert(problems: ReadonlyArray<Problem>) {
  const Alert = await loadAlert();
  const utils = render(<Alert problems={problems} />);
  return {
    ...utils,
    rerenderWith: (next: ReadonlyArray<Problem>) => utils.rerender(<Alert problems={next} />),
  };
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("SavedAccountsAlert — sin problemas no renderiza nada", () => {
  it("con una lista vacía el contenedor queda vacío (ni siquiera un role=alert oculto)", async () => {
    const { container } = await renderAlert([]);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pasar de problemas a ninguno retira la alerta; de ninguno a problemas la muestra (solo depende de las props)", async () => {
    const { container, rerenderWith } = await renderAlert([P1]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    rerenderWith([]);
    expect(container.innerHTML).toBe("");
    rerenderWith([P2]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(text(screen.getByRole("alert"))).toContain(P2.label);
    expect(text(screen.getByRole("alert"))).not.toContain(P1.label);
  });
});

describe("SavedAccountsAlert — con problemas: un role=alert que lo explica", () => {
  it("hay UN role=alert, y no varios (uno por rótulo)", async () => {
    await renderAlert([P1, P2, P3]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("explica que la configuración apunta a una cuenta de TÍTULO", async () => {
    await renderAlert([P1]);
    expect(text(screen.getByRole("alert"))).toMatch(/t[ií]tulo/i);
  });

  it("explica que la cuenta YA NO EXISTE", async () => {
    await renderAlert([P1]);
    expect(text(screen.getByRole("alert"))).toMatch(/ya no existe|no existe/i);
  });

  it("pide cambiarla por una cuenta de MOVIMIENTO para poder GUARDAR", async () => {
    await renderAlert([P1]);
    const message = text(screen.getByRole("alert"));
    expect(message).toMatch(/movimiento/i);
    expect(message).toMatch(/guardar/i);
  });

  it("lista el rótulo de cada campo con problema", async () => {
    await renderAlert([P1, P2, P3]);
    const message = text(screen.getByRole("alert"));
    for (const problem of [P1, P2, P3]) expect(message).toContain(problem.label);
  });

  it("los lista en el orden RECIBIDO (no por clave ni alfabético)", async () => {
    await renderAlert([P2, P3, P1]);
    const message = text(screen.getByRole("alert"));
    const positions = [P2, P3, P1].map((p) => message.indexOf(p.label));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("no lista rótulos que no recibió", async () => {
    await renderAlert([P1]);
    const message = text(screen.getByRole("alert"));
    expect(message).not.toContain(P2.label);
    expect(message).not.toContain(P3.label);
  });

  it("un solo problema: nombra ese campo y solo ese", async () => {
    await renderAlert([P3]);
    const message = text(screen.getByRole("alert"));
    expect(message).toContain("Ganancia Cambiaria");
    expect(message).not.toContain("Resultado del Ejercicio");
  });

  it("muchos problemas (17, como el asistente de nómina): todos aparecen", async () => {
    const many = Array.from({ length: 17 }, (_, i) => ({
      key: `field${i}`,
      label: `Campo contable número ${i + 1}`,
    }));
    await renderAlert(many);
    const message = text(screen.getByRole("alert"));
    for (const problem of many) expect(message).toContain(problem.label);
  });

  it("rótulos con el mismo texto y claves distintas: se listan ambos (la clave solo identifica)", async () => {
    await renderAlert([
      { key: "a", label: "Gasto" },
      { key: "b", label: "Gasto" },
    ]);
    const message = text(screen.getByRole("alert"));
    expect(message.split("Gasto").length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe("SavedAccountsAlert — es solo informativa y segura", () => {
  it("no tiene botones, enlaces ni campos: el usuario corrige en el formulario", async () => {
    await renderAlert([P1, P2]);
    const alert = screen.getByRole("alert");
    expect(within(alert).queryAllByRole("button")).toHaveLength(0);
    expect(within(alert).queryAllByRole("link")).toHaveLength(0);
    expect(alert.querySelectorAll("input, select, textarea, a, button")).toHaveLength(0);
  });

  it("los rótulos se pintan como TEXTO: un rótulo con HTML no crea elementos", async () => {
    const hostile = "<img src=x onerror=alert(1)><b>negrita</b>";
    await renderAlert([{ key: "x", label: hostile }]);
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("img")).toBeNull();
    expect(alert.querySelector("b")).toBeNull();
    expect(text(alert)).toContain(hostile);
  });

  it("no se anuncia como estado ni como diálogo: es una alerta (assertive)", async () => {
    await renderAlert([P1]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("SavedAccountsAlert — accesibilidad (axe)", () => {
  it("sin violaciones serias con uno o varios problemas", async () => {
    const { container, rerenderWith } = await renderAlert([P1]);
    await expectNoSeriousA11yViolations(container);
    rerenderWith([P1, P2, P3]);
    await expectNoSeriousA11yViolations(container);
  });

  it("sin problemas tampoco hay nada que auditar (contenedor vacío)", async () => {
    const { container } = await renderAlert([]);
    await expectNoSeriousA11yViolations(container);
  });
});
