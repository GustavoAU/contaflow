// src/app/api/payments/attachments/upload/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guard: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  persist: vi.fn(),
  configured: vi.fn(),
  paymentFind: vi.fn(),
  attachmentFind: vi.fn(),
  captureException: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException, captureMessage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: { paymentRecord: { findFirst: h.paymentFind }, paymentAttachment: { findFirst: h.attachmentFind } },
}));
vi.mock("@/lib/action-guard", () => ({ requireCompanyAction: h.guard }));
vi.mock("@/lib/ratelimit", () => ({ limiters: { fiscal: {}, read: {} }, checkRateLimit: h.rateLimit }));
vi.mock("@/lib/private-blob", () => ({
  isPrivateBlobConfigured: h.configured,
  putPrivateBlob: h.put,
  deletePrivateBlob: h.del,
}));
vi.mock("@/modules/payments/services/PaymentAttachmentService", () => ({
  PaymentAttachmentService: { persistAttachmentMetadata: h.persist },
}));

import { POST } from "./route";
import { MAX_SIZE_BYTES } from "@/modules/payments/constants/payment-attachment.constants";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

function request(
  opts: {
    file?: Uint8Array | null;
    fields?: Record<string, string>;
    contentLength?: string;
    fileName?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const form = new FormData();
  const fields = opts.fields ?? { companyId: "co-1", paymentRecordId: "pay-1" };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (opts.file !== null) {
    form.set(
      "file",
      new File([(opts.file ?? PDF) as BlobPart], opts.fileName ?? "comprobante.pdf", { type: "application/pdf" }),
    );
  }
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  return new Request("https://contaflow.test/api/payments/attachments/upload", {
    method: "POST",
    body: form,
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.mockReturnValue(true);
  h.auth.mockResolvedValue({ userId: "user-1" });
  h.rateLimit.mockResolvedValue({ allowed: true });
  h.guard.mockResolvedValue({ ok: true, userId: "user-1", role: "ACCOUNTANT", ipAddress: "1.2.3.4", userAgent: "UA" });
  h.paymentFind.mockResolvedValue({ deletedAt: null });
  h.attachmentFind.mockResolvedValue(null);
  h.put.mockResolvedValue({
    url: "https://store.private.blob.vercel-storage.com/co-1/payments/pay-1/x.pdf",
    pathname: "co-1/payments/pay-1/x.pdf",
  });
  h.del.mockResolvedValue(undefined);
  h.persist.mockResolvedValue({ id: "att-1" });
});

describe("POST /api/payments/attachments/upload — subida por el servidor al Blob privado", () => {
  it("503 si el store Blob no está configurado", async () => {
    h.configured.mockReturnValue(false);
    expect((await POST(request())).status).toBe(503);
  });

  it("401 sin sesión y sin leer el cuerpo ni tocar la BD", async () => {
    h.auth.mockResolvedValue({ userId: null });
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it("429 por USUARIO antes de leer el cuerpo: rotar companyId no da un cubo nuevo (auditoría de seguridad)", async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes" });
    const req = request({ fields: { companyId: "empresa-inventada-1", paymentRecordId: "pay-1" } });
    const formData = vi.spyOn(req, "formData");

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(h.rateLimit).toHaveBeenCalledWith("user:user-1", expect.anything());
    expect(formData).not.toHaveBeenCalled();
    expect(h.guard).not.toHaveBeenCalled();
  });

  it("403 si el navegador declara la petición como cross-site (defensa en profundidad contra CSRF)", async () => {
    const res = await POST(request({ headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
    expect(h.auth).not.toHaveBeenCalled();
  });

  it("400 si el Content-Length no es un número válido", async () => {
    expect((await POST(request({ contentLength: "abc" }))).status).toBe(400);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("el nombre guardado lleva la extensión del tipo detectado, no la que puso el usuario (x.pdf.hta)", async () => {
    await POST(request({ fileName: "recibo.hta" }));
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ fileName: "recibo.pdf" }));
  });

  it("413 si el Content-Length declarado supera el tope, antes de leer el cuerpo", async () => {
    const res = await POST(request({ contentLength: String(MAX_SIZE_BYTES + 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("400 si falta el archivo o los ids no son válidos (un objeto no se cuela como filtro)", async () => {
    expect((await POST(request({ file: null }))).status).toBe(400);
    expect((await POST(request({ fields: { companyId: "co 1;", paymentRecordId: "pay-1" } }))).status).toBe(400);
    expect(h.guard).not.toHaveBeenCalled();
  });

  it("413 si el archivo real supera el tope aunque el Content-Length no lo diga", async () => {
    const big = new Uint8Array(MAX_SIZE_BYTES + 1);
    big.set(PDF);
    expect((await POST(request({ file: big }))).status).toBe(413);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("403 si el guard rechaza (no es miembro, rol sin permiso o límite agotado)", async () => {
    h.guard.mockResolvedValue({ ok: false, error: { success: false, error: "No autorizado" } });
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("404 si el pago no es de esa empresa; 409 si está anulado o ya tiene comprobante", async () => {
    h.paymentFind.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    h.paymentFind.mockResolvedValueOnce({ deletedAt: new Date() });
    expect((await POST(request())).status).toBe(409);
    h.attachmentFind.mockResolvedValueOnce({ id: "att-0" });
    expect((await POST(request())).status).toBe(409);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("415 si los bytes no son PDF/JPEG/PNG/WebP, aunque el navegador diga application/pdf", async () => {
    const res = await POST(request({ file: HTML }));
    expect(res.status).toBe(415);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("camino feliz: ruta y SHA-256 los fija el servidor, el blob va privado y se registra con IP/UA", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, attachmentId: "att-1" });
    const [pathname, body, mime] = h.put.mock.calls[0]!;
    expect(pathname).toMatch(/^co-1\/payments\/pay-1\/[0-9a-f-]{36}\.pdf$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(mime).toBe("application/pdf");
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        paymentRecordId: "pay-1",
        mimeType: "application/pdf",
        sizeBytes: PDF.length,
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        blobKey: "co-1/payments/pay-1/x.pdf",
        uploadedBy: "user-1",
        ipAddress: "1.2.3.4",
        userAgent: "UA",
      }),
    );
  });

  it("502 si el store falla al guardar: no se registra nada en la BD", async () => {
    h.put.mockRejectedValue(new Error("boom"));
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.captureException).toHaveBeenCalled();
  });

  it("si falla el registro en BD borra el blob (sin fila no debe quedar huérfano) y responde 409", async () => {
    h.persist.mockRejectedValue(new Error("Este pago ya tiene un comprobante adjunto"));
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(h.del).toHaveBeenCalledWith("https://store.private.blob.vercel-storage.com/co-1/payments/pay-1/x.pdf");
  });
});
