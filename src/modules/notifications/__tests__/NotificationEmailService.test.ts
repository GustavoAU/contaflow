// src/modules/notifications/__tests__/NotificationEmailService.test.ts
// Tests Q1-1: digest diario de notificaciones por empresa

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import * as emailLib from "@/lib/email";
import * as PendingTasksModule from "@/modules/dashboard/services/PendingTasksService";

vi.mock("@/lib/prisma", () => ({
  default: {
    company: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: "msg-001" }),
}));

vi.mock("@/modules/dashboard/services/PendingTasksService", () => ({
  PendingTasksService: {
    getPendingTasks: vi.fn(),
  },
}));

// Mock fetch (used for Clerk API)
global.fetch = vi.fn();

import { NotificationEmailService } from "../services/NotificationEmailService";

const mockCompanies = vi.mocked(prisma.company.findMany);
const mockPendingTasks = vi.mocked(PendingTasksModule.PendingTasksService.getPendingTasks);
const mockSendEmail = vi.mocked(emailLib.sendEmail);
const mockFetch = vi.mocked(global.fetch);

const COMPANY = { id: "co-1", name: "Empresa Demo", members: [{ userId: "u-1" }] };
const ADMIN_EMAIL = "admin@empresa.com";

const TASK_ERROR = {
  type: "INVOICES_SIN_CAUSAR" as const,
  severity: "error" as const,
  title: "Facturas sin causar",
  description: "3 facturas sin asiento.",
  count: 3,
  href: "/invoices",
};

const TASK_INFO = {
  type: "EXTRACTO_SIN_CONCILIAR" as const,
  severity: "info" as const,
  title: "Extractos sin conciliar",
  description: "1 extracto.",
  count: 1,
  href: "/bank-reconciliation",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_SECRET_KEY = "sk_test_1234";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  // Mock Clerk API response
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      email_addresses: [{ email_address: ADMIN_EMAIL, verification: { status: "verified" } }],
    }),
  } as Response);
});

describe("NotificationEmailService.sendDailyDigests", () => {
  it("envía email cuando hay tareas urgentes (error o warning)", async () => {
    mockCompanies.mockResolvedValue([COMPANY] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [TASK_ERROR], totalCount: 1 });

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results).toHaveLength(1);
    expect(results[0].emailsSent).toBe(1);
    expect(results[0].taskCount).toBe(1);
    expect(results[0].skipped).toBe(false);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const callArgs = mockSendEmail.mock.calls[0][0];
    expect(callArgs.to).toContain(ADMIN_EMAIL);
    expect(callArgs.subject).toContain("Empresa Demo");
    expect(callArgs.html).toContain("Facturas sin causar");
  });

  it("omite empresa si solo hay tareas severity=info", async () => {
    mockCompanies.mockResolvedValue([COMPANY] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [TASK_INFO], totalCount: 1 });

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results[0].skipped).toBe(true);
    expect(results[0].emailsSent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("omite empresa sin tareas pendientes", async () => {
    mockCompanies.mockResolvedValue([COMPANY] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [], totalCount: 0 });

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results[0].skipped).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("maneja múltiples empresas independientemente", async () => {
    const co2 = { id: "co-2", name: "Empresa 2", members: [{ userId: "u-2" }] };
    mockCompanies.mockResolvedValue([COMPANY, co2] as never);
    mockPendingTasks
      .mockResolvedValueOnce({ tasks: [TASK_ERROR], totalCount: 1 })   // co-1: enviar
      .mockResolvedValueOnce({ tasks: [], totalCount: 0 });             // co-2: skip

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results).toHaveLength(2);
    expect(results[0].emailsSent).toBe(1);
    expect(results[1].skipped).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("registra error si sendEmail falla pero continúa", async () => {
    mockCompanies.mockResolvedValue([COMPANY] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [TASK_ERROR], totalCount: 1 });
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: "API down" });

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results[0].emailsSent).toBe(0);
    expect(results[0].errors).toContain("API down");
  });

  it("omite empresa si Clerk no devuelve email verificado", async () => {
    mockCompanies.mockResolvedValue([COMPANY] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [TASK_ERROR], totalCount: 1 });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email_addresses: [] }),
    } as Response);

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results[0].skipped).toBe(true);
    expect(results[0].errors).toContain("Sin admins con email verificado");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("omite llamada a Clerk si empresa no tiene miembros ADMIN/OWNER", async () => {
    const companyNoAdmins = { ...COMPANY, members: [] };
    mockCompanies.mockResolvedValue([companyNoAdmins] as never);
    mockPendingTasks.mockResolvedValue({ tasks: [TASK_ERROR], totalCount: 1 });

    const results = await NotificationEmailService.sendDailyDigests();

    expect(results[0].skipped).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

