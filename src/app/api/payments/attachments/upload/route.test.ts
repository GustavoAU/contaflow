// src/app/api/payments/attachments/upload/route.test.ts
// Usa el handleUpload REAL de @vercel/blob: con el SDK mockeado no se veía que ignora el
// pathname que devuelve el servidor y firma el token con el que envía el navegador.
import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";
import { PaymentAttachmentService } from "@/modules/payments/services/PaymentAttachmentService";
import { buildAttachmentPathname } from "@/modules/payments/constants/payment-attachment.constants";
import { POST } from "./route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    paymentRecord: { findFirst: vi.fn() },
    paymentAttachment: { findFirst: vi.fn() },
  },
}));

vi.mock("@/modules/payments/services/PaymentAttachmentService", () => ({
  PaymentAttachmentService: { persistAttachmentMetadata: vi.fn() },
}));

const URL_UPLOAD = "http://localhost/api/payments/attachments/upload";
const TOKEN = "vercel_blob_rw_teststore123_notarealsecret";
const UUID = "11111111-2222-3333-4444-555555555555";
const OK_PATH = buildAttachmentPathname("company-1", "pay-1", "application/pdf", UUID);
const CLIENT_PAYLOAD = {
  companyId: "company-1",
  paymentRecordId: "pay-1",
  contentType: "application/pdf",
  contentHash: "a".repeat(64),
  fileSize: 10,
  fileName: "comprobante.pdf",
};

function tokenRequest(
  pathname: string,
  payload: object = CLIENT_PAYLOAD,
  headers: Record<string, string> = {},
) {
  return new NextRequest(URL_UPLOAD, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: JSON.stringify(payload), multipart: false },
    }),
  });
}

const CALLBACK_BODY = {
  type: "blob.upload-completed",
  payload: {
    blob: {
      url: "https://teststore123.public.blob.vercel-storage.com/company-1/payments/pay-1/u-abc.pdf",
      pathname: "company-1/payments/pay-1/u-abc.pdf",
      contentType: "application/pdf",
    },
    tokenPayload: JSON.stringify({
      companyId: "company-1",
      paymentRecordId: "pay-1",
      contentHash: "a".repeat(64),
      fileSize: 10,
      uploadedBy: "user-1",
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
      originalFileName: "comprobante.pdf",
    }),
  },
};

// Lo que hace Vercel: HMAC-SHA256 hex del cuerpo JSON con el token de lectura/escritura como clave.
function callbackRequest(signature: string) {
  return new NextRequest(URL_UPLOAD, {
    method: "POST",
    headers: { "x-vercel-signature": signature },
    body: JSON.stringify(CALLBACK_BODY),
  });
}
const VALID_SIGNATURE = createHmac("sha256", TOKEN).update(JSON.stringify(CALLBACK_BODY)).digest("hex");

function decodeClientToken(clientToken: string) {
  const signed = Buffer.from(clientToken.split("_").slice(4).join("_"), "base64").toString("utf8");
  const claims = Buffer.from(signed.split(".").slice(1).join("."), "base64").toString("utf8");
  return JSON.parse(claims) as {
    pathname: string;
    addRandomSuffix?: boolean;
    validUntil?: number;
    allowedContentTypes?: string[];
    maximumSizeInBytes?: number;
  };
}

async function expectRejected(res: Response, status: number, message: string) {
  expect(res.status).toBe(status);
  expect((await res.json()).error).toBe(message);
}

describe("POST /api/payments/attachments/upload (handleUpload real)", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue({ deletedAt: null } as never);
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(null as never);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  describe("fase 1: pedir token", () => {
    it("firma el token con la ruta del tenant, sufijo aleatorio y ligado al tipo y tamaño declarados", async () => {
      const res = await POST(tokenRequest(OK_PATH));
      const claims = decodeClientToken((await res.json()).clientToken);

      expect(claims.pathname).toBe(OK_PATH);
      expect(claims.pathname.startsWith("company-1/payments/pay-1/")).toBe(true);
      expect(claims.addRandomSuffix).toBe(true);
      expect(claims.allowedContentTypes).toEqual(["application/pdf"]);
      expect(claims.maximumSizeInBytes).toBe(10);
    });

    it("el token vence en 5 minutos como máximo", async () => {
      const res = await POST(tokenRequest(OK_PATH));
      const claims = decodeClientToken((await res.json()).clientToken);
      const ttl = (claims.validUntil ?? 0) - Date.now();

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5 * 60_000);
    });

    it("rechaza el nombre original del archivo como ruta (antes quedaba en la raíz del store)", async () => {
      await expectRejected(await POST(tokenRequest("comprobante.pdf")), 400, "Ruta de archivo inválida");
    });

    it("rechaza una ruta que apunta a otra empresa", async () => {
      const otraEmpresa = buildAttachmentPathname("company-2", "pay-1", "application/pdf", UUID);
      await expectRejected(await POST(tokenRequest(otraEmpresa)), 400, "Ruta de archivo inválida");
    });

    it("rechaza segmentos extra o traversal", async () => {
      const traversal = `company-1/payments/pay-1/../../company-2/payments/pay-9/${UUID}.pdf`;
      await expectRejected(await POST(tokenRequest(traversal)), 400, "Ruta de archivo inválida");
    });

    it("rechaza extensiones fuera de la lista", async () => {
      const html = `company-1/payments/pay-1/${UUID}.html`;
      await expectRejected(await POST(tokenRequest(html)), 400, "Ruta de archivo inválida");
    });

    it("rechaza una extensión que no corresponde al tipo declarado (el mimeType de BD sale de la extensión)", async () => {
      const png = buildAttachmentPathname("company-1", "pay-1", "image/png", UUID);
      await expectRejected(await POST(tokenRequest(png)), 400, "Ruta de archivo inválida");
    });

    it("rechaza ids que no son string: un objeto se colaría como filtro de Prisma", async () => {
      const payload = { ...CLIENT_PAYLOAD, companyId: { not: "x" }, paymentRecordId: { not: "y" } };
      const pathname = `[object Object]/payments/[object Object]/${UUID}.pdf`;

      await expectRejected(await POST(tokenRequest(pathname, payload)), 400, "Payload inválido");
      expect(vi.mocked(prisma.companyMember.findFirst)).not.toHaveBeenCalled();
    });

    it("rechaza un hash que no es SHA-256 hexadecimal", async () => {
      const res = await POST(tokenRequest(OK_PATH, { ...CLIENT_PAYLOAD, contentHash: "abc" }));
      await expectRejected(res, 400, "Payload inválido");
    });

    it("rechaza un tamaño que no es entero positivo o supera el límite", async () => {
      for (const fileSize of ["10", 0, 6_000_000]) {
        const res = await POST(tokenRequest(OK_PATH, { ...CLIENT_PAYLOAD, fileSize }));
        await expectRejected(res, 400, "Payload inválido");
      }
    });

    it("rechaza un tipo de archivo fuera de la lista", async () => {
      const res = await POST(tokenRequest(OK_PATH, { ...CLIENT_PAYLOAD, contentType: "text/html" }));
      await expectRejected(res, 400, "Tipo de archivo no permitido. Use PDF, JPEG, PNG o WebP.");
    });

    it("rechaza un cuerpo que no es JSON", async () => {
      const req = new NextRequest(URL_UPLOAD, { method: "POST", body: "no soy json" });
      await expectRejected(await POST(req), 400, "Solicitud inválida");
    });
  });

  describe("acceso sin sesión (la ruta es pública para el middleware)", () => {
    it("sin sesión ni firma de Vercel responde 401 sin tocar la base", async () => {
      vi.mocked(auth).mockResolvedValue({ userId: null } as never);

      await expectRejected(await POST(tokenRequest(OK_PATH)), 401, "No autorizado");
      expect(vi.mocked(prisma.companyMember.findFirst)).not.toHaveBeenCalled();
    });

    it("una firma falsa no basta para pedir un token: la fase 1 exige sesión", async () => {
      vi.mocked(auth).mockResolvedValue({ userId: null } as never);
      const res = await POST(tokenRequest(OK_PATH, CLIENT_PAYLOAD, { "x-vercel-signature": "falsa" }));

      await expectRejected(res, 400, "No autorizado");
      expect(vi.mocked(prisma.companyMember.findFirst)).not.toHaveBeenCalled();
    });
  });

  describe("fase 2: callback de Vercel Blob (sin cookies)", () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    });

    it("con la firma correcta registra el adjunto aunque no haya sesión", async () => {
      const res = await POST(callbackRequest(VALID_SIGNATURE));

      expect(res.status).toBe(200);
      expect(vi.mocked(PaymentAttachmentService.persistAttachmentMetadata)).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "company-1",
          paymentRecordId: "pay-1",
          blobKey: "company-1/payments/pay-1/u-abc.pdf",
          mimeType: "application/pdf",
          fileName: "comprobante.pdf",
          uploadedBy: "user-1",
        }),
      );
    });

    it("con una firma inválida no registra nada", async () => {
      const res = await POST(callbackRequest("0".repeat(64)));

      expect(res.status).toBe(400);
      expect(vi.mocked(PaymentAttachmentService.persistAttachmentMetadata)).not.toHaveBeenCalled();
      // Un callback rechazado no debe ser mudo: es lo que pasaría con un token rotado sin redesplegar.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("callback rechazado"), expect.any(String));
    });
  });

  describe("errores inesperados", () => {
    it("con sesión responde 500 genérico, avisa a Sentry y no filtra el mensaje interno", async () => {
      vi.mocked(prisma.companyMember.findFirst).mockRejectedValue(new Error("db down: secreto interno"));

      const res = await POST(tokenRequest(OK_PATH));
      const texto = await res.text();

      expect(res.status).toBe(500);
      expect(texto).toContain("No se pudo procesar la subida");
      expect(texto).not.toContain("secreto interno");
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledOnce();
    });
  });
});
