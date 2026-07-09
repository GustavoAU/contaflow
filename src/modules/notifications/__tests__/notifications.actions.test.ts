// src/modules/notifications/__tests__/notifications.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { NotificationService } from "../services/NotificationService";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("../services/NotificationService", () => ({
  NotificationService: {
    getAlerts: vi.fn().mockResolvedValue([]),
  },
}));

const COMPANY_ID = "company-abc";

import { getNotificationsAction } from "../actions/notifications.actions";
import { auth } from "@clerk/nextjs/server";

describe("getNotificationsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(NotificationService.getAlerts).mockResolvedValue([]);
  });

  it("ACCOUNTANT recibe alertas vacías", async () => {
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("OWNER recibe alertas (ACCOUNTING role)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("ADMIN recibe alertas (ACCOUNTING role)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("ADMINISTRATIVE es rechazado (no es ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMINISTRATIVE" } as never);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result).toEqual({ success: false, error: "Empresa no encontrada o acceso denegado" });
  });

  it("propaga errores del servicio", async () => {
    vi.mocked(NotificationService.getAlerts).mockRejectedValueOnce(new Error("DB error"));
    const result = await getNotificationsAction(COMPANY_ID);
    expect(result).toEqual({ success: false, error: "DB error" });
  });
});
