import { describe, it, expect } from "vitest";
import {
  isExemptModel,
  isWriteOperation,
  extractCompanyId,
  computeWriteAllowed,
  EXEMPT_MODELS,
} from "./prisma-billing-gate";

const DAY = 86_400_000;

describe("isExemptModel", () => {
  it("modelos de sistema están exentos", () => {
    expect(isExemptModel("Subscription")).toBe(true);
    expect(isExemptModel("AuditLog")).toBe(true);
    expect(isExemptModel("Company")).toBe(true);
    expect(isExemptModel("SeniatSubmission")).toBe(true);
  });

  it("modelos de negocio NO están exentos", () => {
    expect(isExemptModel("Invoice")).toBe(false);
    expect(isExemptModel("Transaction")).toBe(false);
    expect(isExemptModel("Retencion")).toBe(false);
    expect(isExemptModel("Expense")).toBe(false);
  });

  it("model undefined se trata como exento (no determinable)", () => {
    expect(isExemptModel(undefined)).toBe(true);
  });
});

describe("isWriteOperation", () => {
  it("operaciones de escritura", () => {
    for (const op of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      expect(isWriteOperation(op)).toBe(true);
    }
  });
  it("operaciones de lectura NO son de escritura", () => {
    for (const op of ["findUnique", "findMany", "findFirst", "count", "aggregate", "groupBy"]) {
      expect(isWriteOperation(op)).toBe(false);
    }
  });
});

describe("extractCompanyId", () => {
  it("data.companyId directo", () => {
    expect(extractCompanyId({ data: { companyId: "c1", total: 100 } })).toBe("c1");
  });
  it("data.company.connect.id", () => {
    expect(extractCompanyId({ data: { company: { connect: { id: "c2" } } } })).toBe("c2");
  });
  it("where.companyId (update/delete)", () => {
    expect(extractCompanyId({ where: { companyId: "c3" } })).toBe("c3");
  });
  it("createMany (array de data)", () => {
    expect(extractCompanyId({ data: [{ companyId: "c4" }, { companyId: "c4" }] })).toBe("c4");
  });
  it("sin companyId determinable → null (permite)", () => {
    expect(extractCompanyId({ where: { id: "x" } })).toBeNull();
    expect(extractCompanyId({ data: { name: "x" } })).toBeNull();
    expect(extractCompanyId(undefined)).toBeNull();
  });
});

describe("computeWriteAllowed", () => {
  const now = Date.now();
  it("sin suscripción → permite", () => {
    expect(computeWriteAllowed(null, now)).toBe(true);
  });
  it("ACTIVE dentro del período → permite", () => {
    expect(computeWriteAllowed({ status: "ACTIVE", currentPeriodEnd: new Date(now + 5 * DAY) }, now)).toBe(true);
  });
  it("ACTIVE pero vencida → bloquea", () => {
    expect(computeWriteAllowed({ status: "ACTIVE", currentPeriodEnd: new Date(now - DAY) }, now)).toBe(false);
  });
  it("EXPIRED → bloquea", () => {
    expect(computeWriteAllowed({ status: "EXPIRED", currentPeriodEnd: new Date(now + 5 * DAY) }, now)).toBe(false);
  });
  it("PAST_DUE con período futuro (checkout) → permite", () => {
    expect(computeWriteAllowed({ status: "PAST_DUE", currentPeriodEnd: new Date(now + 5 * DAY) }, now)).toBe(true);
  });
});

describe("EXEMPT_MODELS cobertura mínima", () => {
  it("incluye billing, auditoría y auth", () => {
    for (const m of ["Subscription", "SubscriptionPayment", "AuditLog", "User", "CompanyMember"]) {
      expect(EXEMPT_MODELS.has(m)).toBe(true);
    }
  });
});
