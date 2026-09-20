// src/app/api/payments/attachments/upload/route.test.ts
// Usa el handleUpload REAL de @vercel/blob: con el SDK mockeado no se veía que ignora el
// pathname que devuelve el servidor y firma el token con el que envía el navegador.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { buildAttachmentPathname } from "@/modules/payments/constants/payment-attachment.constants";
import { POST } from "./route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

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

function makeRequest(pathname: string, payload: object = CLIENT_PAYLOAD) {
  return new NextRequest("http://localhost/api/payments/attachments/upload", {
    method: "POST",
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: JSON.stringify(payload), multipart: false },
    }),
  });
}

function decodeClientToken(clientToken: string) {
  const signed = Buffer.from(clientToken.split("_").slice(4).join("_"), "base64").toString("utf8");
  const claims = Buffer.from(signed.split(".").slice(1).join("."), "base64").toString("utf8");
  return JSON.parse(claims) as { pathname: string; addRandomSuffix?: boolean; validUntil?: number };
}

describe("POST /api/payments/attachments/upload (handleUpload real)", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore123_notarealsecret";
    vi.clearAllMocks();
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

  it("firma el token con la ruta del tenant y sufijo aleatorio", async () => {
    const res = await POST(makeRequest(OK_PATH));
    const claims = decodeClientToken((await res.json()).clientToken);

    expect(claims.pathname).toBe(OK_PATH);
    expect(claims.pathname.startsWith("company-1/payments/pay-1/")).toBe(true);
    expect(claims.addRandomSuffix).toBe(true);
  });

  it("rechaza el nombre original del archivo como ruta (antes quedaba en la raíz del store)", async () => {
    await expect(POST(makeRequest("comprobante.pdf"))).rejects.toThrow("Ruta de archivo inválida");
  });

  it("rechaza una ruta que apunta a otra empresa", async () => {
    const otraEmpresa = buildAttachmentPathname("company-2", "pay-1", "application/pdf", UUID);
    await expect(POST(makeRequest(otraEmpresa))).rejects.toThrow("Ruta de archivo inválida");
  });

  it("rechaza segmentos extra o traversal", async () => {
    const traversal = `company-1/payments/pay-1/../../company-2/payments/pay-9/${UUID}.pdf`;
    await expect(POST(makeRequest(traversal))).rejects.toThrow("Ruta de archivo inválida");
  });

  it("rechaza extensiones fuera de la lista", async () => {
    await expect(POST(makeRequest(`company-1/payments/pay-1/${UUID}.html`))).rejects.toThrow(
      "Ruta de archivo inválida",
    );
  });

  it("sin sesión no genera token", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(POST(makeRequest(OK_PATH))).rejects.toThrow("No autorizado");
  });

  it("rechaza ids que no son string: un objeto se colaría como filtro de Prisma", async () => {
    const payload = { ...CLIENT_PAYLOAD, companyId: { not: "x" }, paymentRecordId: { not: "y" } };
    const pathname = `[object Object]/payments/[object Object]/${UUID}.pdf`;

    await expect(POST(makeRequest(pathname, payload))).rejects.toThrow("Payload inválido");
    expect(vi.mocked(prisma.companyMember.findFirst)).not.toHaveBeenCalled();
  });

  it("rechaza un hash que no es SHA-256 hexadecimal", async () => {
    await expect(POST(makeRequest(OK_PATH, { ...CLIENT_PAYLOAD, contentHash: "abc" }))).rejects.toThrow(
      "Payload inválido",
    );
  });

  it("rechaza un tamaño que no es entero o supera el límite", async () => {
    await expect(POST(makeRequest(OK_PATH, { ...CLIENT_PAYLOAD, fileSize: "10" }))).rejects.toThrow(
      "Payload inválido",
    );
    await expect(POST(makeRequest(OK_PATH, { ...CLIENT_PAYLOAD, fileSize: 6_000_000 }))).rejects.toThrow(
      "Payload inválido",
    );
  });

  it("rechaza un tipo de archivo fuera de la lista", async () => {
    await expect(
      POST(makeRequest(OK_PATH, { ...CLIENT_PAYLOAD, contentType: "text/html" })),
    ).rejects.toThrow("Tipo de archivo no permitido");
  });

  it("el token vence en 10 minutos como máximo", async () => {
    const res = await POST(makeRequest(OK_PATH));
    const claims = decodeClientToken((await res.json()).clientToken);
    const ttl = (claims.validUntil ?? 0) - Date.now();

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });
});
