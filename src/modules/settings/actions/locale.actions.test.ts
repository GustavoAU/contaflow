// src/modules/settings/actions/locale.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn();
const mockGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    set: mockSet,
    get: mockGet,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { setLocaleAction, getLocaleAction } from "./locale.actions";

describe("setLocaleAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el locale válido en cookie", async () => {
    const result = await setLocaleAction("en");
    expect(result.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith("locale", "en", expect.any(Object));
  });

  it("rechaza un locale inválido", async () => {
    const result = await setLocaleAction("fr");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Idioma no válido");
  });
});

describe("getLocaleAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna el locale guardado en cookie", async () => {
    mockGet.mockReturnValue({ value: "en" });
    const locale = await getLocaleAction();
    expect(locale).toBe("en");
  });

  it("retorna es por defecto si no hay cookie", async () => {
    mockGet.mockReturnValue(undefined);
    const locale = await getLocaleAction();
    expect(locale).toBe("es");
  });
});