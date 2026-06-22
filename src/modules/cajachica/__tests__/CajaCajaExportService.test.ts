import { describe, it, expect } from "vitest";
import {
  generateCajaCajaCSV,
  generateCajaCajaPDF,
  type CajaCajaExportData,
} from "../services/CajaCajaExportService";

function buildData(overrides?: Partial<CajaCajaExportData>): CajaCajaExportData {
  return {
    companyName: "ACME C.A.",
    caja: {
      name: "Caja Operativa",
      accountCode: "1010",
      accountName: "Caja VES",
      currency: "VES",
      status: "ACTIVE",
      custodianName: "Ana Pérez",
      totalDeposited: "1000.00",
      totalApprovedMovements: "200.00",
      totalPendingMovements: "50.00",
      availableBalance: "750.00",
    },
    movements: [
      {
        date: "2026-05-12",
        voucherNumber: "CCC-2026-00001",
        // Concepto con coma → debe quedar entre comillas (RFC 4180)
        concept: "Café, té",
        expenseAccountCode: "6010",
        expenseAccountName: "Gastos Operativos",
        providerRif: "J-12345678-9",
        supportingDocumentId: "FAC-001",
        amount: "150000.00",
        currency: "VES",
        status: "PENDING",
      },
    ],
    deposits: [
      {
        date: "2026-05-10",
        amount: "1000.00",
        description: "Reposición inicial",
        status: "POSTED",
      },
    ],
    generatedAt: new Date("2026-05-15T12:00:00Z"),
    ...overrides,
  };
}

describe("generateCajaCajaCSV", () => {
  it("incluye cabeceras de secciones MOVIMIENTOS y DEPÓSITOS", () => {
    const csv = generateCajaCajaCSV(buildData());
    expect(csv).toContain("MOVIMIENTOS (GASTOS)");
    expect(csv).toContain("DEPÓSITOS (REPOSICIONES)");
  });

  it("incluye los valores del movimiento y del depósito", () => {
    const csv = generateCajaCajaCSV(buildData());
    expect(csv).toContain("CCC-2026-00001");
    expect(csv).toContain("J-12345678-9");
    expect(csv).toContain("FAC-001");
    expect(csv).toContain("150000.00");
    expect(csv).toContain("Reposición inicial");
    expect(csv).toContain("1000.00");
  });

  it("escapa con comillas un concepto que contiene coma (RFC 4180)", () => {
    const csv = generateCajaCajaCSV(buildData());
    // El concepto "Café, té" debe quedar entre comillas para no romper columnas.
    expect(csv).toContain('"Café, té"');
    // El valor sin comillas (rompería el CSV) NO debe aparecer como celda cruda.
    expect(csv).not.toContain(",Café, té,");
  });

  it("escapa comillas internas duplicándolas (RFC 4180)", () => {
    const data = buildData();
    data.movements[0].concept = 'Pago "urgente"';
    const csv = generateCajaCajaCSV(data);
    expect(csv).toContain('"Pago ""urgente"""');
  });

  it("encabeza con BOM UTF-8 para que Excel reconozca los acentos", () => {
    const csv = generateCajaCajaCSV(buildData());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa 'Sin custodio' cuando no hay custodio asignado", () => {
    const data = buildData();
    data.caja.custodianName = null;
    const csv = generateCajaCajaCSV(data);
    expect(csv).toContain("Sin custodio");
  });

  it("neutraliza CSV/formula injection: prefija con apóstrofo celdas que empiezan con = + - @ (gate Fase 4 MEDIUM)", () => {
    // Payloads sin comillas/comas para que el apóstrofo quede visible sin quoting RFC.
    for (const payload of ["=1+1", "+1+1", "-2+3", "@SUM"]) {
      const data = buildData();
      data.movements[0].concept = payload;
      const csv = generateCajaCajaCSV(data);
      // La celda queda forzada a texto con apóstrofo inicial.
      expect(csv).toContain(`'${payload}`);
      // Y la fórmula nunca aparece como inicio de celda sin neutralizar (tras coma o salto).
      const esc = payload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(csv).not.toMatch(new RegExp(`(^|[,\\n])${esc}`));
    }
  });
});

describe("generateCajaCajaPDF (smoke)", () => {
  it("devuelve un Buffer que empieza con %PDF", async () => {
    const buffer = await generateCajaCajaPDF(buildData());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 20000);

  it("renderiza sin lanzar cuando no hay movimientos ni depósitos", async () => {
    const buffer = await generateCajaCajaPDF(buildData({ movements: [], deposits: [] }));
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 20000);
});
