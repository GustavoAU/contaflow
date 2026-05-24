// src/modules/vendors/__tests__/client-portal-token.actions.test.ts
// Tests: portal link generation — auth, role, cross-tenant guard

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-admin" }),
}));

vi.mock("@/lib/client-portal-jwt", () => ({
  signClientToken: vi.fn().mockReturnValue("mock.client.jwt"),
}));

import { generateClientPortalTokenAction } from "../actions/client-portal-token.actions";

const mockMember = vi.mocked(prisma.companyMember.findFirst);
const mockCustomer = vi.mocked(prisma.customer.findFirst);

function makeMember(role: string) {
  return { role } as never;
}

const customer = { id: "cust-1", name: "Empresa ABC" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

describe("generateClientPortalTokenAction", () => {
  it("returns a URL for an ADMIN member", async () => {
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockCustomer.mockResolvedValue(customer);

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toBe("https://app.example.com/client-portal/mock.client.jwt");
    }
  });

  it("returns a URL for an OWNER member", async () => {
    mockMember.mockResolvedValue(makeMember("OWNER"));
    mockCustomer.mockResolvedValue(customer);

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(true);
  });

  it("rejects when user has no session", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/autenticado/i);
  });

  it("rejects when user is not a company member", async () => {
    mockMember.mockResolvedValue(null);

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/acceso/i);
  });

  it("rejects for ACCOUNTANT role (insufficient)", async () => {
    mockMember.mockResolvedValue(makeMember("ACCOUNTANT"));

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/administrador/i);
  });

  it("rejects for VIEWER role (insufficient)", async () => {
    mockMember.mockResolvedValue(makeMember("VIEWER"));

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/administrador/i);
  });

  it("rejects when customer does not belong to the company (cross-tenant guard)", async () => {
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockCustomer.mockResolvedValue(null);

    const result = await generateClientPortalTokenAction("co-1", "cust-other-company");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/cliente/i);
  });

  it("uses localhost fallback when NEXT_PUBLIC_APP_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    mockMember.mockResolvedValue(makeMember("ADMIN"));
    mockCustomer.mockResolvedValue(customer);

    const result = await generateClientPortalTokenAction("co-1", "cust-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.url).toContain("localhost:3000");
    }
  });
});
