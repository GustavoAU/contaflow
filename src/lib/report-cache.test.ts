// src/lib/report-cache.test.ts
// Tests para el módulo de cache en memoria de reportes contables.
// Vitest 4 — environment: node (global en vitest.config.ts)

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeCacheKey,
  getCached,
  setCached,
  invalidatePeriod,
  withPeriodCache,
  CLOSED_PERIOD_TTL_MS,
} from "./report-cache";

// Limpiar el módulo entre tests para tener un cache limpio
// El cache es un Map interno — lo reseteamos manipulando el módulo
beforeEach(async () => {
  // Re-importar el módulo con estado fresco no es trivial sin vi.resetModules().
  // En su lugar, usamos invalidatePeriod para limpiar las claves de los tests,
  // o seteamos con TTL=0 para expirarlas. La estrategia más simple:
  // guardamos bajo claves únicas por test (companyId/periodId únicos).
});

// ─── makeCacheKey ─────────────────────────────────────────────────────────────

describe("makeCacheKey", () => {
  it("genera key con formato companyId:periodId:reportType", () => {
    const key = makeCacheKey("company-1", "period-1", "transactions");
    expect(key).toBe("company-1:period-1:transactions");
  });

  it("genera keys distintas para diferentes companyId (multi-tenant)", () => {
    const k1 = makeCacheKey("company-A", "period-1", "balance");
    const k2 = makeCacheKey("company-B", "period-1", "balance");
    expect(k1).not.toBe(k2);
  });
});

// ─── getCached ────────────────────────────────────────────────────────────────

describe("getCached", () => {
  it("retorna null si la key no existe en el cache", () => {
    const result = getCached("key-que-no-existe-xyz-9999");
    expect(result).toBeNull();
  });

  it("retorna null si la entrada expiró", () => {
    const key = makeCacheKey("company-exp", "period-exp", "test");
    // TTL negativo: expiresAt = Date.now() - 1 → ya expiró en el momento de crear
    setCached(key, { data: "valor" }, -1); // TTL negativo garantiza expiración inmediata

    const result = getCached(key);
    expect(result).toBeNull();
  });

  it("retorna el dato si existe y no expiró", () => {
    const key = makeCacheKey("company-ok", "period-ok", "test");
    const payload = { transactions: [{ id: "tx-1" }], total: 1 };

    setCached(key, payload, CLOSED_PERIOD_TTL_MS);

    const result = getCached<typeof payload>(key);
    expect(result).toEqual(payload);
  });
});

// ─── setCached ────────────────────────────────────────────────────────────────

describe("setCached", () => {
  it("almacena el dato correctamente y es recuperable con getCached", () => {
    const key = makeCacheKey("company-set", "period-set", "balance");
    const data = { balance: "1500.00", currency: "VES" };

    setCached(key, data);

    expect(getCached(key)).toEqual(data);
  });

  it("usa CLOSED_PERIOD_TTL_MS como TTL por defecto", () => {
    // Verificar que el dato sigue presente después de ser seteado
    const key = makeCacheKey("company-ttl", "period-ttl", "balance");
    setCached(key, "valor-ttl-default");

    // El dato debe existir con el TTL default
    const result = getCached(key);
    expect(result).toBe("valor-ttl-default");
  });

  it("sobreescribe una entrada existente con el mismo key", () => {
    const key = makeCacheKey("company-overwrite", "period-overwrite", "tx");
    setCached(key, "primer-valor", CLOSED_PERIOD_TTL_MS);
    setCached(key, "segundo-valor", CLOSED_PERIOD_TTL_MS);

    expect(getCached(key)).toBe("segundo-valor");
  });
});

// ─── invalidatePeriod ─────────────────────────────────────────────────────────

describe("invalidatePeriod", () => {
  it("elimina todas las entradas del período indicado sin afectar otros períodos", () => {
    const companyId = "company-inv";
    const periodA = "period-A";
    const periodB = "period-B";

    const keyA1 = makeCacheKey(companyId, periodA, "transactions");
    const keyA2 = makeCacheKey(companyId, periodA, "balance");
    const keyB1 = makeCacheKey(companyId, periodB, "transactions");

    setCached(keyA1, "datos-A-tx");
    setCached(keyA2, "datos-A-bal");
    setCached(keyB1, "datos-B-tx");

    // Invalidar solo el período A
    invalidatePeriod(companyId, periodA);

    expect(getCached(keyA1)).toBeNull();
    expect(getCached(keyA2)).toBeNull();
    expect(getCached(keyB1)).toBe("datos-B-tx"); // período B intacto
  });

  it("no lanza error si el período no tiene entradas en cache", () => {
    expect(() => invalidatePeriod("company-empty", "period-empty")).not.toThrow();
  });

  it("elimina solo entradas de la empresa indicada (aislamiento multi-tenant)", () => {
    const periodId = "period-shared";

    const keyCompanyX = makeCacheKey("company-X", periodId, "balance");
    const keyCompanyY = makeCacheKey("company-Y", periodId, "balance");

    setCached(keyCompanyX, "datos-X");
    setCached(keyCompanyY, "datos-Y");

    invalidatePeriod("company-X", periodId);

    expect(getCached(keyCompanyX)).toBeNull();
    expect(getCached(keyCompanyY)).toBe("datos-Y"); // otra empresa intacta
  });
});

// ─── withPeriodCache ──────────────────────────────────────────────────────────

describe("withPeriodCache", () => {
  it("usa cache en período CLOSED: fn se llama solo una vez en dos llamadas", async () => {
    const companyId = "company-closed";
    const periodId = "period-closed-001";
    const reportType = "transactions";

    const fn = vi.fn().mockResolvedValue({ data: [{ id: "tx-1" }], total: 1 });

    // Primera llamada — cache miss → ejecuta fn
    const result1 = await withPeriodCache(companyId, periodId, "CLOSED", reportType, fn);
    // Segunda llamada — cache hit → NO ejecuta fn
    const result2 = await withPeriodCache(companyId, periodId, "CLOSED", reportType, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
    expect(result1).toEqual({ data: [{ id: "tx-1" }], total: 1 });
  });

  it("NO cachea en período OPEN: fn se llama en cada invocación", async () => {
    const companyId = "company-open";
    const periodId = "period-open-001";
    const reportType = "transactions";

    const fn = vi
      .fn()
      .mockResolvedValueOnce({ data: [], total: 0 })
      .mockResolvedValueOnce({ data: [{ id: "tx-new" }], total: 1 });

    const result1 = await withPeriodCache(companyId, periodId, "OPEN", reportType, fn);
    const result2 = await withPeriodCache(companyId, periodId, "OPEN", reportType, fn);

    expect(fn).toHaveBeenCalledTimes(2);
    // Resultados distintos porque fn retorna valores diferentes
    expect(result1).toEqual({ data: [], total: 0 });
    expect(result2).toEqual({ data: [{ id: "tx-new" }], total: 1 });
  });

  it("propaga errores de fn sin cachear resultado fallido", async () => {
    const companyId = "company-err";
    const periodId = "period-err-001";
    const reportType = "balance";

    const fn = vi.fn().mockRejectedValue(new Error("DB error"));

    await expect(
      withPeriodCache(companyId, periodId, "CLOSED", reportType, fn)
    ).rejects.toThrow("DB error");

    // El cache no debe tener nada tras un error
    const key = makeCacheKey(companyId, periodId, reportType);
    expect(getCached(key)).toBeNull();
  });

  it("invalida y recalcula correctamente después de invalidatePeriod", async () => {
    const companyId = "company-reinval";
    const periodId = "period-reinval-001";
    const reportType = "balance";

    const fn = vi
      .fn()
      .mockResolvedValueOnce({ balance: "1000.00" })
      .mockResolvedValueOnce({ balance: "2000.00" });

    // Primera llamada — cachea
    await withPeriodCache(companyId, periodId, "CLOSED", reportType, fn);
    expect(fn).toHaveBeenCalledTimes(1);

    // Invalidar
    invalidatePeriod(companyId, periodId);

    // Segunda llamada — cache miss → fn se llama de nuevo
    const result = await withPeriodCache(companyId, periodId, "CLOSED", reportType, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ balance: "2000.00" });
  });
});
