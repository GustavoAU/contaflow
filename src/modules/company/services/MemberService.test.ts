// src/modules/company/services/MemberService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from "./MemberService";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const ACTOR_USER_ID = "actor-1";
const TARGET_USER_ID = "target-1";

const MEMBER_ROW = {
  id: "member-1",
  userId: TARGET_USER_ID,
  companyId: COMPANY_ID,
  role: "ACCOUNTANT" as const,
  user: { id: TARGET_USER_ID, name: "Juan Pérez", email: "juan@example.com" },
};

const USER_ROW = {
  id: TARGET_USER_ID,
  name: "Juan Pérez",
  email: "juan@example.com",
};

// ─── listMembers ──────────────────────────────────────────────────────────────

describe("listMembers", () => {
  it("retorna lista de miembros", async () => {
    vi.mocked(prisma.companyMember.findMany).mockResolvedValue([MEMBER_ROW] as never);

    const result = await listMembers(COMPANY_ID);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("ACCOUNTANT");
    expect(prisma.companyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });
});

// ─── addMember ────────────────────────────────────────────────────────────────

describe("addMember", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          companyMember: prisma.companyMember,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("crea miembro correctamente", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(USER_ROW as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.companyMember.create).mockResolvedValue(MEMBER_ROW as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await addMember(COMPANY_ID, "juan@example.com", "ACCOUNTANT", ACTOR_USER_ID);

    expect(result.role).toBe("ACCOUNTANT");
    expect(prisma.companyMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "ACCOUNTANT" }) })
    );
  });

  it("lanza error si el usuario no existe en ContaFlow", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(
      addMember(COMPANY_ID, "noexiste@example.com", "ACCOUNTANT", ACTOR_USER_ID)
    ).rejects.toThrow("Usuario no encontrado");
  });

  it("lanza error si el usuario ya es miembro", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(USER_ROW as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(MEMBER_ROW as never);

    await expect(
      addMember(COMPANY_ID, "juan@example.com", "ACCOUNTANT", ACTOR_USER_ID)
    ).rejects.toThrow("ya es miembro");
  });

  it("lanza error si se intenta asignar rol OWNER", async () => {
    await expect(
      addMember(COMPANY_ID, "juan@example.com", "OWNER", ACTOR_USER_ID)
    ).rejects.toThrow("Propietario");
  });

  it("normaliza el email a minúsculas", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(USER_ROW as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.companyMember.create).mockResolvedValue(MEMBER_ROW as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await addMember(COMPANY_ID, "JUAN@EXAMPLE.COM", "ACCOUNTANT", ACTOR_USER_ID);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "juan@example.com" },
    });
  });
});

// ─── updateMemberRole ─────────────────────────────────────────────────────────

describe("updateMemberRole", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          companyMember: prisma.companyMember,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("actualiza rol correctamente", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ROW as never);
    vi.mocked(prisma.companyMember.update).mockResolvedValue({
      ...MEMBER_ROW,
      role: "ADMIN",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await updateMemberRole(COMPANY_ID, TARGET_USER_ID, "ADMIN", ACTOR_USER_ID);

    expect(result.role).toBe("ADMIN");
    expect(prisma.companyMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "ADMIN" } })
    );
  });

  it("lanza error si se intenta asignar rol OWNER", async () => {
    await expect(
      updateMemberRole(COMPANY_ID, TARGET_USER_ID, "OWNER", ACTOR_USER_ID)
    ).rejects.toThrow("Propietario");
  });

  it("lanza error si el actor cambia su propio rol", async () => {
    await expect(
      updateMemberRole(COMPANY_ID, ACTOR_USER_ID, "ADMIN", ACTOR_USER_ID)
    ).rejects.toThrow("propio rol");
  });

  it("lanza error si el miembro no existe (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    await expect(
      updateMemberRole(COMPANY_ID, TARGET_USER_ID, "ADMIN", ACTOR_USER_ID)
    ).rejects.toThrow("Miembro no encontrado");
  });

  it("lanza error si el miembro es OWNER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      ...MEMBER_ROW,
      role: "OWNER",
    } as never);

    await expect(
      updateMemberRole(COMPANY_ID, TARGET_USER_ID, "ADMIN", ACTOR_USER_ID)
    ).rejects.toThrow("Propietario");
  });
});

// ─── removeMember ─────────────────────────────────────────────────────────────

describe("removeMember", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          companyMember: prisma.companyMember,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("elimina miembro correctamente", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ROW as never);
    vi.mocked(prisma.companyMember.delete).mockResolvedValue(MEMBER_ROW as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await expect(
      removeMember(COMPANY_ID, TARGET_USER_ID, ACTOR_USER_ID)
    ).resolves.toBeUndefined();

    expect(prisma.companyMember.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_companyId: { userId: TARGET_USER_ID, companyId: COMPANY_ID } },
      })
    );
  });

  it("lanza error si el actor intenta eliminarse a sí mismo", async () => {
    await expect(
      removeMember(COMPANY_ID, ACTOR_USER_ID, ACTOR_USER_ID)
    ).rejects.toThrow("eliminarte a ti mismo");
  });

  it("lanza error si el miembro no existe (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    await expect(
      removeMember(COMPANY_ID, TARGET_USER_ID, ACTOR_USER_ID)
    ).rejects.toThrow("Miembro no encontrado");
  });

  it("lanza error si el miembro es OWNER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      ...MEMBER_ROW,
      role: "OWNER",
      user: { email: "owner@example.com" },
    } as never);

    await expect(
      removeMember(COMPANY_ID, TARGET_USER_ID, ACTOR_USER_ID)
    ).rejects.toThrow("Propietario");
  });
});
