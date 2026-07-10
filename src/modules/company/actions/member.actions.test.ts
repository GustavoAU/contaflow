// src/modules/company/actions/member.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  getMembersAction,
  addMemberAction,
  updateMemberRoleAction,
  removeMemberAction,
} from "./member.actions";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "actor-1", has: () => true }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/MemberService", () => ({
  listMembers: vi.fn(),
  addMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import * as MemberService from "../services/MemberService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";

const OWNER_MEMBER = {
  id: "member-owner",
  userId: "actor-1",
  companyId: COMPANY_ID,
  role: "OWNER" as const,
};

const VIEWER_ACTOR = {
  id: "member-viewer",
  userId: "actor-1",
  companyId: COMPANY_ID,
  role: "VIEWER" as const,
};

const MEMBER_ROW = {
  id: "member-2",
  userId: "target-1",
  companyId: COMPANY_ID,
  role: "ACCOUNTANT" as const,
  user: { id: "target-1", name: "Juan", email: "juan@example.com" },
};

// ─── getMembersAction ─────────────────────────────────────────────────────────

describe("getMembersAction", () => {
  it("retorna miembros si el usuario pertenece a la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
    vi.mocked(MemberService.listMembers).mockResolvedValue([MEMBER_ROW]);

    const result = await getMembersAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });

  it("rechaza si el usuario no pertenece a la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await getMembersAction(COMPANY_ID);

    expect(result.success).toBe(false);
  });

  it("rechaza si no hay userId (no autenticado)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    const result = await getMembersAction(COMPANY_ID);

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("No autorizado");
  });
});

// ─── addMemberAction ──────────────────────────────────────────────────────────

describe("addMemberAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
    vi.mocked(MemberService.addMember).mockResolvedValue({ id: "member-new" } as never);
  });

  it("agrega miembro si el actor es OWNER", async () => {
    const result = await addMemberAction({
      companyId: COMPANY_ID,
      email: "nuevo@example.com",
      role: "ACCOUNTANT",
    });

    expect(result.success).toBe(true);
    expect(MemberService.addMember).toHaveBeenCalledWith(
      COMPANY_ID,
      "nuevo@example.com",
      "ACCOUNTANT",
      "actor-1",
      null,
      null
    );
  });

  it("rechaza si el actor no tiene rol ADMIN_ONLY", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_ACTOR as never);

    const result = await addMemberAction({
      companyId: COMPANY_ID,
      email: "nuevo@example.com",
      role: "ACCOUNTANT",
    });

    expect(result.success).toBe(false);
  });

  it("rechaza con datos inválidos (email inválido)", async () => {
    const result = await addMemberAction({
      companyId: COMPANY_ID,
      email: "no-es-email",
      role: "ACCOUNTANT",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("Datos inválidos");
  });

  it("propaga error del servicio", async () => {
    vi.mocked(MemberService.addMember).mockRejectedValueOnce(
      new Error("Usuario no encontrado")
    );

    const result = await addMemberAction({
      companyId: COMPANY_ID,
      email: "noexiste@example.com",
      role: "ACCOUNTANT",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain("no encontrado");
  });
});

// ─── updateMemberRoleAction ───────────────────────────────────────────────────

describe("updateMemberRoleAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
    vi.mocked(MemberService.updateMemberRole).mockResolvedValue({
      id: "member-2",
      role: "ADMIN",
    } as never);
  });

  it("actualiza rol si el actor es OWNER", async () => {
    const result = await updateMemberRoleAction({
      companyId: COMPANY_ID,
      targetUserId: "target-1",
      role: "ADMIN",
    });

    expect(result.success).toBe(true);
    expect(MemberService.updateMemberRole).toHaveBeenCalledWith(
      COMPANY_ID,
      "target-1",
      "ADMIN",
      "actor-1"
    );
  });

  it("rechaza si el actor no es ADMIN_ONLY", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_ACTOR as never);

    const result = await updateMemberRoleAction({
      companyId: COMPANY_ID,
      targetUserId: "target-1",
      role: "ADMIN",
    });

    expect(result.success).toBe(false);
  });

  it("propaga error del servicio", async () => {
    vi.mocked(MemberService.updateMemberRole).mockRejectedValueOnce(
      new Error("No se puede modificar el rol del Propietario.")
    );

    const result = await updateMemberRoleAction({
      companyId: COMPANY_ID,
      targetUserId: "owner-id",
      role: "ADMIN",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain("Propietario");
  });
});

// ─── removeMemberAction ───────────────────────────────────────────────────────

describe("removeMemberAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
    vi.mocked(MemberService.removeMember).mockResolvedValue(undefined);
  });

  it("elimina miembro si el actor es OWNER", async () => {
    const result = await removeMemberAction({
      companyId: COMPANY_ID,
      targetUserId: "target-1",
    });

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(true);
    expect(MemberService.removeMember).toHaveBeenCalledWith(
      COMPANY_ID,
      "target-1",
      "actor-1",
      null,
      null
    );
  });

  it("rechaza si el actor no es ADMIN_ONLY", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_ACTOR as never);

    const result = await removeMemberAction({
      companyId: COMPANY_ID,
      targetUserId: "target-1",
    });

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(false);
  });

  it("propaga error del servicio (no puede eliminarse a sí mismo)", async () => {
    vi.mocked(MemberService.removeMember).mockRejectedValueOnce(
      new Error("No puedes eliminarte a ti mismo.")
    );

    const result = await removeMemberAction({
      companyId: COMPANY_ID,
      targetUserId: "actor-1",
    });

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("eliminarte");
  });
});
