// src/modules/payments/services/PaymentAttachmentService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { PaymentAttachmentService } from "./PaymentAttachmentService";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    paymentAttachment: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

const PAYLOAD = {
  companyId: "company-1",
  paymentRecordId: "pay-1",
  fileName: "comprobante.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1234,
  blobUrl: "https://store.public.blob.vercel-storage.com/company-1/payments/pay-1/u-abc.pdf",
  blobKey: "company-1/payments/pay-1/u-abc.pdf",
  contentHash: "a".repeat(64),
  uploadedBy: "user-1",
  ipAddress: "1.2.3.4",
  userAgent: "vitest",
};

const CREATED_ROW = {
  id: "att-1",
  ...PAYLOAD,
  uploadedAt: new Date("2026-09-19T12:00:00Z"),
  deletedAt: null,
  deletedBy: null,
};

describe("PaymentAttachmentService.persistAttachmentMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "pay-1" }] as never);
    vi.mocked(prisma.paymentAttachment.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: prisma.$queryRaw,
        paymentAttachment: prisma.paymentAttachment,
        auditLog: prisma.auditLog,
      })) as never);
  });

  it("si el pago se anuló mientras se subía el archivo (el bloqueo no encuentra fila activa) no adjunta nada", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    await expect(PaymentAttachmentService.persistAttachmentMetadata(PAYLOAD)).rejects.toThrow(
      "El pago no existe o fue anulado",
    );

    expect(vi.mocked(prisma.paymentAttachment.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).not.toHaveBeenCalled();
  });

  it("tope por pago: los comprobantes eliminados también cuentan (el soft-delete conserva el blob)", async () => {
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.paymentAttachment.count).mockResolvedValue(10 as never);

    await expect(PaymentAttachmentService.persistAttachmentMetadata(PAYLOAD)).rejects.toThrow(
      "alcanzó el máximo de 10 comprobantes",
    );

    expect(vi.mocked(prisma.paymentAttachment.count)).toHaveBeenCalledWith({
      where: { paymentRecordId: "pay-1", companyId: "company-1" }, // sin deletedAt: cuenta también los eliminados
    });
    expect(vi.mocked(prisma.paymentAttachment.create)).not.toHaveBeenCalled();
  });

  it("crea el adjunto y su AuditLog cuando el pago no tiene uno activo", async () => {
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.paymentAttachment.create).mockResolvedValue(CREATED_ROW as never);

    const result = await PaymentAttachmentService.persistAttachmentMetadata(PAYLOAD);

    expect(result.id).toBe("att-1");
    expect(vi.mocked(prisma.paymentAttachment.create)).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledOnce();
  });

  it("D-5: rechaza un segundo adjunto activo del mismo pago sin crear nada (token reutilizado)", async () => {
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue({ id: "att-previo" } as never);

    await expect(PaymentAttachmentService.persistAttachmentMetadata(PAYLOAD)).rejects.toThrow(
      "Este pago ya tiene un comprobante adjunto",
    );

    expect(vi.mocked(prisma.paymentAttachment.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.paymentAttachment.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentRecordId: "pay-1", companyId: "company-1", deletedAt: null },
      }),
    );
  });

  it("B1: bloquea la fila del pago (FOR UPDATE, con companyId) antes de comprobar D-5", async () => {
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.paymentAttachment.create).mockResolvedValue(CREATED_ROW as never);

    await PaymentAttachmentService.persistAttachmentMetadata(PAYLOAD);

    const lock = vi.mocked(prisma.$queryRaw);
    expect(lock).toHaveBeenCalledOnce();
    expect(lock.mock.calls[0].slice(1)).toEqual(["pay-1", "company-1"]);
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.paymentAttachment.findFirst).mock.invocationCallOrder[0],
    );
  });
});
