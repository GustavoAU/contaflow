// src/app/api/company/[companyId]/fiscal-reports/[reportId]/download/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { GET } from "./route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  fiscalKey: vi.fn((companyId: string, userId: string) => `${companyId}:${userId}`),
  limiters: { read: {} },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    fiscalReport: { findFirst: vi.fn() },
  },
}));

const BLOB_URL = "https://store.private.blob.vercel-storage.com/fiscal/company-1/libro-ventas-2026-09-abc.pdf";
const REPORT = {
  blobUrl: BLOB_URL,
  reportType: "LIBRO_VENTAS",
  year: 2026,
  month: 9,
  contentHash: "a".repeat(64),
};

function call(companyId = "company-1", reportId = "rep-1") {
  return GET(new Request("http://localhost/x"), { params: Promise.resolve({ companyId, reportId }) });
}

function blobResult(text = "%PDF-fake") {
  return { statusCode: 200, stream: new Response(text).body, blob: { contentType: "application/pdf" } };
}

describe("GET /api/company/[companyId]/fiscal-reports/[reportId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "VEN" },
    } as never);
    vi.mocked(prisma.fiscalReport.findFirst).mockResolvedValue(REPORT as never);
    vi.mocked(get).mockResolvedValue(blobResult() as never);
  });

  it("entrega el PDF en stream con cabeceras de descarga y sin caché compartida", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-fake");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="libro-ventas-2026-09.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Content-SHA256")).toBe("a".repeat(64));
    expect(vi.mocked(get)).toHaveBeenCalledWith(BLOB_URL, expect.objectContaining({ access: "private" }));
  });

  it("sin sesión responde 401 y no toca la base ni el blob", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const res = await call();

    expect(res.status).toBe(401);
    expect(vi.mocked(prisma.companyMember.findFirst)).not.toHaveBeenCalled();
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("con el límite de lecturas agotado responde 429", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes" } as never);

    const res = await call();

    expect(res.status).toBe(429);
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("quien no es miembro de la empresa recibe 403", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const res = await call();

    expect(res.status).toBe(403);
    expect(vi.mocked(prisma.fiscalReport.findFirst)).not.toHaveBeenCalled();
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("un rol sin acceso contable (VIEWER) recibe 403", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "VIEWER",
      company: { country: "VEN" },
    } as never);

    const res = await call();

    expect(res.status).toBe(403);
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("un reporte de otra empresa da 404 (el where lleva companyId) y no toca el blob", async () => {
    vi.mocked(prisma.fiscalReport.findFirst).mockResolvedValue(null as never);

    const res = await call("company-1", "rep-de-otra-empresa");

    expect(res.status).toBe(404);
    expect(vi.mocked(prisma.fiscalReport.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rep-de-otra-empresa", companyId: "company-1" } }),
    );
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("si el archivo ya no está en el store responde 404", async () => {
    vi.mocked(get).mockResolvedValue(null as never);

    expect((await call()).status).toBe(404);
  });

  it("si el store falla responde 502 genérico, avisa a Sentry y no filtra el detalle", async () => {
    vi.mocked(get).mockRejectedValue(new Error("token rw_secreto rechazado"));

    const res = await call();
    const texto = await res.text();

    expect(res.status).toBe(502);
    expect(texto).not.toContain("rw_secreto");
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledOnce();
  });
});
