// src/modules/retentions/services/RetentionService.test.ts
import { describe, it, expect } from "vitest";
import { RetentionService } from "./RetentionService";

describe("RetentionService.calculateIvaRetention", () => {
  it("calcula retención IVA al 75% correctamente", () => {
    const result = RetentionService.calculateIvaRetention("1000.00", 16, 75);
    expect(result.ivaAmount).toBe("160.00");
    expect(result.ivaRetention).toBe("120.00");
    expect(result.ivaRetentionPct).toBe(75);
  });

  it("calcula retención IVA al 100% correctamente", () => {
    const result = RetentionService.calculateIvaRetention("1000.00", 16, 100);
    expect(result.ivaAmount).toBe("160.00");
    expect(result.ivaRetention).toBe("160.00");
    expect(result.ivaRetentionPct).toBe(100);
  });

  it("calcula correctamente con base imponible decimal", () => {
    const result = RetentionService.calculateIvaRetention("840696.00", 16, 75);
    expect(result.ivaAmount).toBe("134511.36");
    expect(result.ivaRetention).toBe("100883.52");
  });
});

describe("RetentionService.calculateIslrRetention", () => {
  it("calcula retención ISLR para servicios PJ al 2%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "SERVICIOS_PJ");
    expect(result).not.toBeNull();
    expect(result!.islrAmount).toBe("20.00");
    expect(result!.islrRetentionPct).toBe(2);
  });

  it("calcula retención ISLR para honorarios PN al 5%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "HONORARIOS_PN");
    expect(result).not.toBeNull();
    expect(result!.islrAmount).toBe("50.00");
    expect(result!.islrRetentionPct).toBe(5);
  });

  it("retorna null si el código ISLR no existe", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "CODIGO_INVALIDO");
    expect(result).toBeNull();
  });
});

describe("RetentionService.calculate", () => {
  it("calcula retención completa IVA + ISLR", () => {
    const result = RetentionService.calculate("1000.00", 75, "SERVICIOS_PJ");
    expect(result.ivaRetention).toBe("120.00");
    expect(result.islrAmount).toBe("20.00");
    expect(result.totalRetention).toBe("140.00");
  });

  it("calcula retención solo IVA sin ISLR", () => {
    const result = RetentionService.calculate("1000.00", 75);
    expect(result.ivaRetention).toBe("120.00");
    expect(result.islrAmount).toBeNull();
    expect(result.totalRetention).toBe("120.00");
  });

  it("calcula retención IVA 100% + ISLR", () => {
    const result = RetentionService.calculate("1000.00", 100, "SERVICIOS_PJ");
    expect(result.ivaRetention).toBe("160.00");
    expect(result.islrAmount).toBe("20.00");
    expect(result.totalRetention).toBe("180.00");
  });
});

describe("RetentionService.validateRif", () => {
  it("valida RIF correcto formato J", () => {
    expect(RetentionService.validateRif("J-40137367-4")).toBe(true);
  });

  it("valida RIF correcto formato V", () => {
    expect(RetentionService.validateRif("V-12345678-9")).toBe(true);
  });

  it("rechaza RIF sin guiones", () => {
    expect(RetentionService.validateRif("J401373674")).toBe(false);
  });

  it("rechaza RIF con letra inválida", () => {
    expect(RetentionService.validateRif("X-12345678-9")).toBe(false);
  });
});
