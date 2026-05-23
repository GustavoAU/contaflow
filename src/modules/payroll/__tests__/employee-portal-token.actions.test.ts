// src/modules/payroll/__tests__/employee-portal-token.actions.test.ts
// Tests: portal link generation — auth, role, cross-tenant guard

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-admin" }),
}));

vi.mock("@/lib/employee-portal-jwt", () => ({
  signEmployeeToken: vi.fn().mockReturnValue("mock.jwt.token"),
}));

import { generatePortalTokenAction } from "../actions/employee-portal-token.actions";

const mockMember = vi.mocked(prisma.companyMember.findFirst);
const mockEmployee = vi.mocked(prisma.employee.findFirst);

function makeMember(role: string) {
  return { role } as never;
}

const emp = { id: "emp-1", firstName: "Ana", lastName: "García" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

describe("generatePortalTokenAction", () => {
  it("returns a URL for an ADMIN member", async () => {
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockEmployee.mockResolvedValue(emp);

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toBe("https://app.example.com/employee/mock.jwt.token");
    }
  });

  it("returns a URL for an OWNER member", async () => {
    mockMember.mockResolvedValue(makeMember("OWNER"));
    mockEmployee.mockResolvedValue(emp);

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(true);
  });

  it("rejects when user has no session", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/autenticado/i);
  });

  it("rejects when user is not a company member", async () => {
    mockMember.mockResolvedValue(null);

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/acceso/i);
  });

  it("rejects for VIEWER role (insufficient)", async () => {
    mockMember.mockResolvedValue(makeMember("VIEWER"));

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/administrador/i);
  });

  it("rejects for ACCOUNTANT role (insufficient)", async () => {
    mockMember.mockResolvedValue(makeMember("ACCOUNTANT"));

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/administrador/i);
  });

  it("rejects when employee does not belong to the company (cross-tenant guard)", async () => {
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockEmployee.mockResolvedValue(null); // not found in this company

    const result = await generatePortalTokenAction("co-1", "emp-other-company");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/empleado/i);
  });

  it("uses localhost fallback when NEXT_PUBLIC_APP_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockEmployee.mockResolvedValue(emp);

    const result = await generatePortalTokenAction("co-1", "emp-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toContain("localhost:3000");
    }
  });
});
