// src/app/api/company/[companyId]/payments/attachments/[attachmentId]/download/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guard: vi.fn(),
  rateLimit: vi.fn(),
  find: vi.fn(),
  get: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.captureMessage, captureException: h.captureException }));
vi.mock("@/lib/prisma", () => ({ default: { paymentAttachment: { findFirst: h.find } } }));
vi.mock("@/lib/action-guard", () => ({ requireCompanyAction: h.guard }));
vi.mock("@/lib/ratelimit", () => ({ limiters: { read: {} }, checkRateLimit: h.rateLimit }));
vi.mock("@/lib/private-blob", () => ({ getPrivateBlob: h.get }));

import { GET } from "./route";

const KEY = "co-1/payments/pay-1/0b5d1c1e-6f0a-4c33-9a57-3f2d8e9b7a10.pdf";
const ROW = {
  paymentRecordId: "pay-1",
  blobKey: KEY,
  fileName: "Transferencia ñandú.pdf",
  mimeType: "application/pdf",
  contentHash: "a".repeat(64),
};
const call = () =>
  GET(new Request("https://contaflow.test/x"), { params: Promise.resolve({ companyId: "co-1", attachmentId: "att-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ userId: "user-1" });
  h.rateLimit.mockResolvedValue({ allowed: true });
  h.guard.mockResolvedValue({ ok: true, userId: "user-1", role: "VIEWER" });
  h.find.mockResolvedValue(ROW);
  h.get.mockResolvedValue({ statusCode: 200, stream: new Response("%PDF-1.4").body });
});

describe("GET /api/company/[companyId]/payments/attachments/[attachmentId]/download", () => {
  it("401 sin sesión", async () => {
    h.auth.mockResolvedValue({ userId: null });
    expect((await call()).status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();
  });

  it("429 si se agota el límite por usuario", async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes" });
    expect((await call()).status).toBe(429);
  });

  it("403 si no es miembro de la empresa", async () => {
    h.guard.mockResolvedValue({ ok: false, error: { success: false, error: "Empresa no encontrada o acceso denegado" } });
    expect((await call()).status).toBe(403);
    expect(h.find).not.toHaveBeenCalled();
  });

  it("404 si el comprobante no es de esa empresa o está eliminado: el where lleva companyId (ADR-004)", async () => {
    h.find.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "att-1", companyId: "co-1", deletedAt: null } }),
    );
  });

  it("404 y aviso a Sentry si la ruta guardada no cuelga de su empresa y su pago", async () => {
    h.find.mockResolvedValue({ ...ROW, blobKey: "otra-empresa/payments/pay-1/0b5d1c1e-6f0a-4c33-9a57-3f2d8e9b7a10.pdf" });
    expect((await call()).status).toBe(404);
    expect(h.captureMessage).toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
  });

  it("502 si el store falla; 404 si el blob no existe", async () => {
    h.get.mockRejectedValueOnce(new Error("boom"));
    expect((await call()).status).toBe(502);
    h.get.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });

  it("200: lee por pathname (no por URL) y sirve con cabeceras seguras y el tipo guardado", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(h.get).toHaveBeenCalledWith(KEY, expect.any(AbortSignal));
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-SHA256")).toBe("a".repeat(64));
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition).toContain("inline");
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("Transferencia ñandú.pdf")}`);
    expect(disposition).toContain('filename="Transferencia_and_.pdf"'); // ASCII de respaldo sin caracteres raros
  });

  it("un mimeType guardado fuera de la lista se sirve como binario, no como HTML", async () => {
    h.find.mockResolvedValue({ ...ROW, mimeType: "text/html" });
    expect((await call()).headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
