// src/modules/bank-reconciliation/services/__tests__/GeminiBankStatementService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiBankStatementService } from "../GeminiBankStatementService";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeGeminiResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

const validExtracted = {
  rows: [
    {
      date: "30/03/2026",
      description: "Compra de POS DebitMC",
      reference: "330154935",
      debit: "943,00",
      credit: null,
      balance: "13.130,06",
    },
  ],
  openingBalance: "14.073,06",
  closingBalance: "13.130,06",
  accountNumber: "***9550",
  bankName: "Banco Nacional de Crédito",
  periodStart: "30/03/2026",
  periodEnd: "30/03/2026",
  holderName: "URUEÑA GUSTAVO ADOLFO",
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

describe("GeminiBankStatementService.extractFromPdf", () => {
  it("happy path: retorna ExtractedBankStatement válido", async () => {
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(JSON.stringify(validExtracted)));
    const result = await GeminiBankStatementService.extractFromPdf("base64data");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBe("30/03/2026");
    expect(result.rows[0].debit).toBe("943,00");
    expect(result.bankName).toBe("Banco Nacional de Crédito");
  });

  it("preserva formato venezolano en montos (no convierte)", async () => {
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(JSON.stringify(validExtracted)));
    const result = await GeminiBankStatementService.extractFromPdf("base64data");
    // Los montos deben llegar como strings venezolanos sin convertir
    expect(result.rows[0].debit).toBe("943,00");
    expect(result.openingBalance).toBe("14.073,06");
  });

  it("maneja JSON envuelto en markdown ```json```", async () => {
    const wrapped = "```json\n" + JSON.stringify(validExtracted) + "\n```";
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(wrapped));
    const result = await GeminiBankStatementService.extractFromPdf("base64data");
    expect(result.rows).toHaveLength(1);
  });

  it("lanza error si Gemini retorna HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    await expect(GeminiBankStatementService.extractFromPdf("base64data")).rejects.toThrow(
      "Gemini API error 500"
    );
  });

  it("lanza error si Gemini retorna error en el body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" },
      }),
    });
    await expect(GeminiBankStatementService.extractFromPdf("base64data")).rejects.toThrow(
      "Gemini API error 429"
    );
  });

  it("lanza error si Gemini retorna JSON inválido", async () => {
    mockFetch.mockResolvedValueOnce(makeGeminiResponse("esto no es json {{{"));
    await expect(GeminiBankStatementService.extractFromPdf("base64data")).rejects.toThrow(
      "JSON inválido"
    );
  });

  it("lanza error si GEMINI_API_KEY no está configurada", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(GeminiBankStatementService.extractFromPdf("base64data")).rejects.toThrow(
      "GEMINI_API_KEY no está configurada"
    );
  });
});
