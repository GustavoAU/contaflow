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

// Payload real de ve.dolarapi.com/v1/dolares/oficial (campo camelCase)
const VALID_USD_PAYLOAD = {
  moneda: "USD",
  fuente: "oficial",
  nombre: "Dólar",
  compra: null,
  venta: null,
  promedio: 46.5,
  fechaActualizacion: "2026-04-07T00:00:00-04:00",
};

// Payload real de ve.dolarapi.com/v1/euros/oficial (mismo schema que USD)
const VALID_EUR_PAYLOAD = {
  moneda: "EUR",
  fuente: "oficial",
  nombre: "Euro",
  compra: null,
  venta: null,
  promedio: 567.58,
  fechaActualizacion: "2026-04-07T00:00:00-04:00",
};

// ─── fetchUsdVes ──────────────────────────────────────────────────────────────
describe("BcvFetchService.fetchUsdVes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BCV_API_URL;
  });

  afterEach(() => {
    delete process.env.BCV_API_URL;
  });

  it("retorna rate y date correctos cuando la API responde bien", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(VALID_USD_PAYLOAD));

    const result = await BcvFetchService.fetchUsdVes();

    expect(result.rate).toBeInstanceOf(Decimal);
    expect(result.rate.toFixed(2)).toBe("46.50");
    expect(result.rawRate).toBe(46.5);
    expect(result.date.getUTCHours()).toBe(0);
    expect(result.date.getUTCMinutes()).toBe(0);
    expect(result.date.getUTCFullYear()).toBe(2026);
    expect(result.date.getUTCMonth()).toBe(3); // abril (0-indexed)
    expect(result.date.getUTCDate()).toBe(7);
  });

  it("la fecha en el resultado es siempre UTC medianoche (@@unique compatible)", async () => {
    const payload = { ...VALID_USD_PAYLOAD, fechaActualizacion: "2026-04-07T23:59:59-04:00" };
    mockFetch.mockResolvedValue(makeOkResponse(payload));

    const result = await BcvFetchService.fetchUsdVes();
    expect(result.date.getUTCSeconds()).toBe(0);
    expect(result.date.getUTCMilliseconds()).toBe(0);
  });

  it("usa BCV_API_URL si está definida en el entorno", async () => {
    process.env.BCV_API_URL = "https://custom-bcv.example.com/rate";
    mockFetch.mockResolvedValue(makeOkResponse(VALID_USD_PAYLOAD));

    await BcvFetchService.fetchUsdVes();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-bcv.example.com/rate",
      expect.any(Object),
    );
  });

  it("la tasa es una instancia de Decimal (no float)", async () => {
    const payload = { ...VALID_USD_PAYLOAD, promedio: 46.333333 };
    mockFetch.mockResolvedValue(makeOkResponse(payload));

    const result = await BcvFetchService.fetchUsdVes();
    expect(result.rate).toBeInstanceOf(Decimal);
    expect(result.rate.toString()).toContain("46.333333");
  });

  it("lanza Error descriptivo cuando fetch lanza excepción de red", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: no se pudo contactar el endpoint BCV",
    );
  });

  it("lanza Error descriptivo cuando la API responde HTTP 500", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: el endpoint BCV USD respondió con HTTP 500",
    );
  });

  it("lanza Error descriptivo cuando la API responde HTTP 429 (rate limit)", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(429));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: el endpoint BCV USD respondió con HTTP 429",
    );
  });

  it("lanza Error descriptivo cuando la respuesta no es JSON válido", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    } as unknown as Response;
    mockFetch.mockResolvedValue(badResponse);

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: la respuesta del endpoint BCV USD no es JSON válido",
    );
  });

  it("lanza Error descriptivo cuando falta el campo 'promedio'", async () => {
    const badPayload = { fuente: "BCV", fechaActualizacion: "2026-04-07T12:00:00Z" };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });

  it("lanza Error descriptivo cuando 'promedio' es cero", async () => {
    const badPayload = { ...VALID_USD_PAYLOAD, promedio: 0 };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });

  it("lanza Error descriptivo cuando 'promedio' es negativo", async () => {
    const badPayload = { ...VALID_USD_PAYLOAD, promedio: -10 };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchUsdVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV",
    );
  });
});

// ─── fetchEurVes ──────────────────────────────────────────────────────────────
describe("BcvFetchService.fetchEurVes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BCV_EUR_API_URL;
  });

  afterEach(() => {
    delete process.env.BCV_EUR_API_URL;
  });

  it("retorna rate EUR/VES y date correctos cuando la API responde bien", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(VALID_EUR_PAYLOAD));

    const result = await BcvFetchService.fetchEurVes();

    expect(result.rate).toBeInstanceOf(Decimal);
    expect(result.rate.toFixed(2)).toBe("567.58");
    expect(result.rawRate).toBe(567.58);
    expect(result.date.getUTCFullYear()).toBe(2026);
    expect(result.date.getUTCMonth()).toBe(3); // abril
    expect(result.date.getUTCDate()).toBe(7);
    expect(result.date.getUTCHours()).toBe(0);
  });

  it("usa BCV_EUR_API_URL si está definida en el entorno", async () => {
    process.env.BCV_EUR_API_URL = "https://custom-eur.example.com/rate";
    mockFetch.mockResolvedValue(makeOkResponse(VALID_EUR_PAYLOAD));

    await BcvFetchService.fetchEurVes();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-eur.example.com/rate",
      expect.any(Object),
    );
  });

  it("lanza Error descriptivo cuando fetch EUR lanza excepción de red", async () => {
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(BcvFetchService.fetchEurVes()).rejects.toThrow(
      "BcvFetchService: no se pudo contactar el endpoint BCV EUR",
    );
  });

  it("lanza Error descriptivo cuando la API EUR responde HTTP 404", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(404));

    await expect(BcvFetchService.fetchEurVes()).rejects.toThrow(
      "BcvFetchService: el endpoint BCV EUR respondió con HTTP 404",
    );
  });

  it("lanza Error descriptivo cuando falta el campo 'promedio'", async () => {
    const badPayload = { fuente: "oficial", fechaActualizacion: "2026-04-07T00:00:00-04:00" };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchEurVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV EUR",
    );
  });

  it("lanza Error descriptivo cuando 'promedio' es cero", async () => {
    const badPayload = { ...VALID_EUR_PAYLOAD, promedio: 0 };
    mockFetch.mockResolvedValue(makeOkResponse(badPayload));

    await expect(BcvFetchService.fetchEurVes()).rejects.toThrow(
      "BcvFetchService: respuesta inesperada del endpoint BCV EUR",
    );
  });
});
