// src/modules/auth/__tests__/user.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { currentUser } from "@clerk/nextjs/server";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { upsert: vi.fn() },
    companyMember: { findMany: vi.fn() },
  },
}));

import {
  syncUserAction,
  getUserCompaniesAction,
  getArchivedCompaniesAction,
} from "../actions/user.actions";

const clerkUser = {
  id: "user-clerk-1",
  fullName: "Ana García",
  emailAddresses: [{ emailAddress: "ana@empresa.com" }],
};

const dbUser = { id: "user-clerk-1", name: "Ana García", email: "ana@empresa.com" };

const makeMembership = (status: "ACTIVE" | "ARCHIVED") => ({
  role: "ADMIN",
  company: { id: "co-1", name: "Empresa A", status },
});

describe("syncUserAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserta y retorna el usuario cuando hay sesión activa", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.user.upsert).mockResolvedValue(dbUser as never);

    const result = await syncUserAction();

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-clerk-1" },
        update: { name: "Ana García", email: "ana@empresa.com" },
        create: { id: "user-clerk-1", name: "Ana García", email: "ana@empresa.com" },
      }),
    );
    expect(result).toEqual(dbUser);
  });

  it("retorna null cuando no hay usuario autenticado", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const result = await syncUserAction();

    expect(result).toBeNull();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("retorna null cuando la DB falla (Neon cold start)", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.user.upsert).mockRejectedValueOnce(new Error("DB error"));

    const result = await syncUserAction();

    expect(result).toBeNull();
  });
});

describe("getUserCompaniesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna empresas ACTIVE con su rol", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockResolvedValue([
      makeMembership("ACTIVE"),
    ] as never);

    const result = await getUserCompaniesAction();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "co-1", status: "ACTIVE", role: "ADMIN" });
  });

  it("filtra por status ACTIVE", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockResolvedValue([] as never);

    await getUserCompaniesAction();

    expect(prisma.companyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ company: { status: "ACTIVE" } }),
      }),
    );
  });

  it("retorna [] cuando no hay usuario autenticado", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const result = await getUserCompaniesAction();

    expect(result).toEqual([]);
  });

  it("retorna [] cuando la DB falla", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockRejectedValueOnce(new Error("DB error"));

    const result = await getUserCompaniesAction();

    expect(result).toEqual([]);
  });
});

describe("getArchivedCompaniesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna empresas ARCHIVED con su rol", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockResolvedValue([
      makeMembership("ARCHIVED"),
    ] as never);

    const result = await getArchivedCompaniesAction();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "co-1", status: "ARCHIVED", role: "ADMIN" });
  });

  it("filtra por status ARCHIVED", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockResolvedValue([] as never);

    await getArchivedCompaniesAction();

    expect(prisma.companyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ company: { status: "ARCHIVED" } }),
      }),
    );
  });

  it("retorna [] cuando no hay usuario autenticado", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);

    const result = await getArchivedCompaniesAction();

    expect(result).toEqual([]);
  });

  it("retorna [] cuando la DB falla", async () => {
    vi.mocked(currentUser).mockResolvedValue(clerkUser as never);
    vi.mocked(prisma.companyMember.findMany).mockRejectedValueOnce(new Error("DB error"));

    const result = await getArchivedCompaniesAction();

    expect(result).toEqual([]);
  });
});
