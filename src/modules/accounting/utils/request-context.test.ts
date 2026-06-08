// src/modules/accounting/utils/request-context.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import { extractRequestContext } from "./request-context";

function mockHeaders(values: Record<string, string | null>) {
  vi.mocked(headers).mockResolvedValue({
    get: (name: string) => values[name] ?? null,
  } as never);
}

describe("extractRequestContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna null para IP y User-Agent cuando no hay ningun header relevante", async () => {
    mockHeaders({});

    const ctx = await extractRequestContext();

    expect(ctx.ipAddress).toBeNull();
    expect(ctx.userAgent).toBeNull();
  });

  it("usa x-real-ip cuando esta disponible", async () => {
    mockHeaders({ "x-real-ip": "1.2.3.4" });

    const ctx = await extractRequestContext();

    expect(ctx.ipAddress).toBe("1.2.3.4");
  });

  it("prioriza x-real-ip sobre x-forwarded-for cuando ambos estan presentes", async () => {
    mockHeaders({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 10.0.0.1" });

    const ctx = await extractRequestContext();

    expect(ctx.ipAddress).toBe("1.2.3.4");
  });

  it("extrae el primer IP de x-forwarded-for cuando x-real-ip no esta disponible", async () => {
    mockHeaders({ "x-forwarded-for": "10.0.0.1, 192.168.1.1, 172.16.0.1" });

    const ctx = await extractRequestContext();

    // El primer valor es la IP original del cliente (los proxies se agregan a la derecha)
    expect(ctx.ipAddress).toBe("10.0.0.1");
  });

  it("elimina espacios del IP extraido de x-forwarded-for", async () => {
    mockHeaders({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" });

    const ctx = await extractRequestContext();

    expect(ctx.ipAddress).toBe("203.0.113.5");
  });

  it("retorna el User-Agent correctamente", async () => {
    mockHeaders({ "user-agent": "Mozilla/5.0 (Windows NT 10.0)" });

    const ctx = await extractRequestContext();

    expect(ctx.userAgent).toBe("Mozilla/5.0 (Windows NT 10.0)");
  });

  it("trunca User-Agent a 512 caracteres para prevenir payloads maliciosos en AuditLog", async () => {
    mockHeaders({ "user-agent": "A".repeat(600) });

    const ctx = await extractRequestContext();

    expect(ctx.userAgent).toHaveLength(512);
    expect(ctx.userAgent).toBe("A".repeat(512));
  });

  it("retorna null para User-Agent cuando el header esta vacio", async () => {
    mockHeaders({ "user-agent": "" });

    const ctx = await extractRequestContext();

    expect(ctx.userAgent).toBeNull();
  });
});
