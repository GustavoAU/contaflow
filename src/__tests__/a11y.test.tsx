// @vitest-environment jsdom
// src/__tests__/a11y.test.tsx — prueba que el helper realmente detecta (no es un test que no puede fallar).
/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text --
   las <img> sin alt son A PROPÓSITO: son la violación que el helper debe detectar. */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  expectKnownA11yDebt,
  expectNoSeriousA11yViolations,
  getSeriousA11yViolations,
  formatA11yViolations,
} from "./a11y";

describe("helper a11y (axe-core)", () => {
  it("detecta <img> sin alt: image-alt, impact critical", async () => {
    const { container } = render(<img src="x.png" />);
    const violations = await getSeriousA11yViolations(container);
    expect(violations.map((v) => v.id)).toContain("image-alt");
    expect(violations.find((v) => v.id === "image-alt")?.impact).toBe("critical");
    await expect(expectNoSeriousA11yViolations(container)).rejects.toThrow(/image-alt/);
  });

  it("el mensaje de fallo incluye regla, impacto, ayuda y HTML del nodo", async () => {
    const { container } = render(<img src="x.png" />);
    const msg = formatA11yViolations(await getSeriousA11yViolations(container));
    expect(msg).toContain("[critical] image-alt");
    expect(msg).toContain("<img");
  });

  it("<img> con alt pasa", async () => {
    const { container } = render(<img src="x.png" alt="logo" />);
    expect(await getSeriousA11yViolations(container)).toEqual([]);
    await expectNoSeriousA11yViolations(container);
  });

  it("ignora impacto no serious (p. ej. region/moderate no cuenta)", async () => {
    const { container } = render(<div>texto suelto</div>);
    expect(await getSeriousA11yViolations(container)).toEqual([]);
  });
});

describe("helper a11y — expectKnownA11yDebt", () => {
  it("pasa cuando las reglas violadas son exactamente las registradas", async () => {
    const { container } = render(<img src="x.png" />);
    await expectKnownA11yDebt(container, ["image-alt"]);
  });

  it("falla ante una regla NUEVA (regresión)", async () => {
    const { container } = render(
      <div>
        <img src="x.png" />
        <input type="text" />
      </div>
    );
    await expect(expectKnownA11yDebt(container, ["image-alt"])).rejects.toThrow(/label/);
  });

  it("falla cuando la deuda se corrigió y pide quitar la marca", async () => {
    const { container } = render(<img src="x.png" alt="logo" />);
    await expect(expectKnownA11yDebt(container, ["image-alt"])).rejects.toThrow(
      /expectNoSeriousA11yViolations/
    );
  });
});
