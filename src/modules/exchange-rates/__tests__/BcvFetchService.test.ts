// src/modules/exchange-rates/__tests__/BcvFetchService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Decimal } from "decimal.js";
import { BcvFetchService } from "../services/BcvFetchService";

// ─── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: vi.fn(),
  } as unknown as Response;
}

const VALID_PAYLOAD = {
  fuente: "BCV",
  nombre: "Dólar BCV",
  promedio: 46.5,
  promedio_real: 46.5,
  fecha_actualizacion: "2026-04-07T12:00:00.000Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("BcvFetchService.fetchUsdVes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env var override between tests
    delete process.env.BCV_API_URL;
  });

  afterEach(() => {
    delete process.env.BCV_API_URL;
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  it("retorna rate y date correctos cuando la API responde bien", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(VALID_PAYLOAD));

    const result = await BcvFetchService.fetchUsdVes();

    expect(result.rate).toBeInstanceOf(Decimal);
    expect(result.rate.toFixed(2)).toBe("46.50");
    expect(result.rawRate).toBe(46.5);

    // Fecha normalizada a 00:00:00 UTC del día correspondiente
    expect(result.date.getUTCHours()).toBe(0);
    expect(result.date.getUTCMinutes()).toBe(0);
    expect(result.date.getUTCFullYear()).toBe(2026);
    expect(result.date.getUTCMonth()).toBe(3); // abril (0-indexed)
    expect(result.date.getUTCDate()).toBe(7);
  });

  it("la fecha en el resultado es siempre UTC medianoche (@@unique compatible)", async () => {
    // La fecha puede venir en distintos formatos de la API
    const payload = { ...VALID_PAYLOAD, fecha_actualizacion: "2026-04-07T23:59:59-04:00" };
    mockFetch.mockResolvedValue(makeOkResponse(payload));

    const result = await BcvFetchService.fetchUsdVes();
    expect(result.date.getUTCSeconds()).toBe(0);
    expect(result.date.getUTCMilliseconds()).toBe(0);
  });

  it("usa BCV_API_URL si está definida en el entorno", async () => {
    process.env.BCV_API_URL = "https://custom-bcv.example.com/rate";
    mockFetch.mockResolvedValue(makeOkResponse(VALID_PAYLOAD));

    await BcvFetchService.fetchUsdVes();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-bcv.example.com/rate",
      expect.any(Object),
    );
  });

  it("la tasa es una instancia de Decimal (no float)", async () => {
    // Valor con precisión que haría fallar a IEEE 754
    const payload = { ...VALID_PAYLOAD, promedio: 46.333333 };
    mockFetch.mockResolvedValue(makeOkResponse(payload));

    const result = await BcvFetchService.fetchUsdVes();
    expect(result.rate).toBeInstanceOf(Decimal);
    // Decimal.js preserva la precisión correctamente
    expect(result.rate.toString()).toContain("46.333333");
  });

  // ── Error: fetch falla ──────────────────────────────────────────────────────
  it("lanza Error descriptivo cuando fetch lanza excepción de red", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: no se pudo contactar el endpoint BCV",
    );
  });

  // ── Error: HTTP no-ok ────────────────────────────────────────────────────────
  it("lanza Error descriptivo cuando la API responde HTTP 500", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: el endpoint BCV respondió con HTTP 500",
    );
  });

  it("lanza Error descriptivo cuando la API responde HTTP 429 (rate limit)", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(429));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: el endpoint BCV respondió con HTTP 429",
    );
  });

  // ── Error: JSON inválido ────────────────────────────────────────────────────
  it("lanza Error descriptivo cuando la respuesta no es JSON válido", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    } as unknown as Response;
    mockFetch.mockResolvedValue(badResponse);

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: la respuesta del endpoint BCV no es JSON válido",
    );
  });

  // ── Error: schema inesperado ────────────────────────────────────────────────
  it("lanza Error descriptivo cuando falta el campo 'promedio'", async () => {
    const badPayload = { fuente: "BCV", fecha_actualizacion: "2026-04-07T12:00:00Z" };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });

  it("lanza Error descriptivo cuando 'promedio' es cero", async () => {
    const badPayload = { ...VALID_PAYLOAD, promedio: 0 };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });

  it("lanza Error descriptivo cuando 'promedio' es negativo", async () => {
    const badPayload = { ...VALID_PAYLOAD, promedio: -10 };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });
});
