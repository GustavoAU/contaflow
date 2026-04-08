// src/modules/invoices/services/SeniatXMLService.test.ts
import { describe, it, expect } from "vitest";
import { SeniatXMLService, type SeniatXMLParams } from "./SeniatXMLService";

// ─── Fixture base ──────────────────────────────────────────────────────────────

const BASE_PARAMS: SeniatXMLParams = {
  companyName: "Distribuidora XYZ C.A.",
  companyRif: "J-12345678-9",
  companyAddress: "Av. Principal, Caracas",
  invoiceType: "SALE",
  docType: "FACTURA",
  invoiceNumber: "0001234",
  controlNumber: "00-0001234",
  date: new Date("2026-04-07T00:00:00.000Z"),
  currency: "VES",
  counterpartName: "Cliente ABC S.A.",
  counterpartRif: "J-98765432-1",
  taxLines: [
    { taxType: "IVA_GENERAL", base: "1000.00", rate: "16.00", amount: "160.00" },
  ],
};

// ─── generate() ───────────────────────────────────────────────────────────────

describe("SeniatXMLService.generate", () => {
  it("incluye declaración XML y namespace correcto", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="urn:ve:seniat:factura:1.0"');
  });

  it("incluye datos del encabezado correctamente", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).toContain("<TipoDocumento>FACTURA</TipoDocumento>");
    expect(xml).toContain("<TipoOperacion>VENTA</TipoOperacion>");
    expect(xml).toContain("<NumeroFactura>0001234</NumeroFactura>");
    expect(xml).toContain("<NumeroControl>00-0001234</NumeroControl>");
    expect(xml).toContain("<FechaEmision>2026-04-07</FechaEmision>");
    expect(xml).toContain("<Moneda>VES</Moneda>");
  });

  it("incluye datos del emisor y receptor", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).toContain("<RIF>J-12345678-9</RIF>");
    expect(xml).toContain("<RazonSocial>Distribuidora XYZ C.A.</RazonSocial>");
    expect(xml).toContain("<Direccion>Av. Principal, Caracas</Direccion>");
    expect(xml).toContain("<RIF>J-98765432-1</RIF>");
    expect(xml).toContain("<RazonSocial>Cliente ABC S.A.</RazonSocial>");
  });

  it("genera AlicuotaGeneral correctamente", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).toContain('<AlicuotaGeneral tasa="16.00">');
    expect(xml).toContain("<BaseImponible>1000.00</BaseImponible>");
    expect(xml).toContain("<MontoIVA>160.00</MontoIVA>");
  });

  it("calcula totales correctamente (base + IVA)", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).toContain("<TotalBaseImponible>1000.00</TotalBaseImponible>");
    expect(xml).toContain("<TotalIVA>160.00</TotalIVA>");
    expect(xml).toContain("<MontoTotal>1160.00</MontoTotal>");
  });

  it("suma múltiples taxLines para los totales", () => {
    const params: SeniatXMLParams = {
      ...BASE_PARAMS,
      taxLines: [
        { taxType: "IVA_GENERAL", base: "1000.00", rate: "16.00", amount: "160.00" },
        { taxType: "IVA_REDUCIDO", base: "500.00", rate: "8.00", amount: "40.00" },
        { taxType: "IVA_ADICIONAL", base: "200.00", rate: "15.00", amount: "30.00" },
      ],
    };
    const xml = SeniatXMLService.generate(params);
    expect(xml).toContain("<TotalBaseImponible>1700.00</TotalBaseImponible>");
    expect(xml).toContain("<TotalIVA>230.00</TotalIVA>");
    expect(xml).toContain("<MontoTotal>1930.00</MontoTotal>");
    expect(xml).toContain('<AlicuotaReducida tasa="8.00">');
    expect(xml).toContain('<AlicuotaAdicional tasa="15.00">');
  });

  it("incluye nodo Exento para taxType EXENTO", () => {
    const params: SeniatXMLParams = {
      ...BASE_PARAMS,
      taxLines: [{ taxType: "EXENTO", base: "300.00", rate: "0", amount: "0.00" }],
    };
    const xml = SeniatXMLService.generate(params);
    expect(xml).toContain("<Exento>");
    expect(xml).toContain("<BaseImponible>300.00</BaseImponible>");
    expect(xml).not.toContain("<MontoIVA>");
  });

  it("TipoOperacion es COMPRA para invoiceType PURCHASE", () => {
    const xml = SeniatXMLService.generate({ ...BASE_PARAMS, invoiceType: "PURCHASE" });
    expect(xml).toContain("<TipoOperacion>COMPRA</TipoOperacion>");
  });

  it("omite NumeroControl si es null (ADR-008 D-7)", () => {
    const xml = SeniatXMLService.generate({ ...BASE_PARAMS, controlNumber: null });
    expect(xml).not.toContain("<NumeroControl>");
  });

  it("omite Direccion si companyAddress es null (ADR-008 D-7)", () => {
    const xml = SeniatXMLService.generate({ ...BASE_PARAMS, companyAddress: null });
    expect(xml).not.toContain("<Direccion>");
  });

  it("omite sección Retenciones si no hay retenciones (ADR-008 D-7)", () => {
    const xml = SeniatXMLService.generate(BASE_PARAMS);
    expect(xml).not.toContain("<Retenciones>");
  });

  it("incluye Retenciones IVA con comprobante si ivaRetentionAmount > 0", () => {
    const xml = SeniatXMLService.generate({
      ...BASE_PARAMS,
      ivaRetentionAmount: "75.00",
      ivaRetentionVoucher: "00000001",
    });
    expect(xml).toContain("<Retenciones>");
    expect(xml).toContain("<IVA>");
    expect(xml).toContain("<Monto>75.00</Monto>");
    expect(xml).toContain("<NumeroComprobante>00000001</NumeroComprobante>");
  });

  it("incluye Retenciones ISLR si islrRetentionAmount > 0", () => {
    const xml = SeniatXMLService.generate({
      ...BASE_PARAMS,
      islrRetentionAmount: "50.00",
    });
    expect(xml).toContain("<ISLR>");
    expect(xml).toContain("<Monto>50.00</Monto>");
  });

  it("omite sección IGTF si igtfAmount es cero (ADR-008 D-7)", () => {
    const xml = SeniatXMLService.generate({ ...BASE_PARAMS, igtfAmount: "0.00" });
    expect(xml).not.toContain("<IGTF>");
  });

  it("incluye sección IGTF si igtfAmount > 0", () => {
    const xml = SeniatXMLService.generate({
      ...BASE_PARAMS,
      igtfBase: "1000.00",
      igtfAmount: "30.00",
    });
    expect(xml).toContain("<IGTF>");
    expect(xml).toContain("<Base>1000.00</Base>");
    expect(xml).toContain("<Monto>30.00</Monto>");
  });

  it("escapa caracteres especiales XML en RazonSocial (ADR-008 D-6)", () => {
    const xml = SeniatXMLService.generate({
      ...BASE_PARAMS,
      companyName: "Empresa <XYZ> & Cia C.A.",
    });
    expect(xml).toContain("Empresa &lt;XYZ&gt; &amp; Cia C.A.");
    expect(xml).not.toContain("<XYZ>");
  });

  it("escapa caracteres especiales XML en numeración", () => {
    const xml = SeniatXMLService.generate({
      ...BASE_PARAMS,
      invoiceNumber: "001&002",
    });
    expect(xml).toContain("<NumeroFactura>001&amp;002</NumeroFactura>");
  });

  it("mapea correctamente docType NOTA_CREDITO", () => {
    const xml = SeniatXMLService.generate({ ...BASE_PARAMS, docType: "NOTA_CREDITO" });
    expect(xml).toContain("<TipoDocumento>NOTA_DE_CREDITO</TipoDocumento>");
  });
});

// ─── filename() ───────────────────────────────────────────────────────────────

describe("SeniatXMLService.filename", () => {
  it("genera nombre para factura de venta", () => {
    expect(SeniatXMLService.filename({ invoiceType: "SALE", invoiceNumber: "0001234" }))
      .toBe("factura-venta-0001234.xml");
  });

  it("genera nombre para factura de compra", () => {
    expect(SeniatXMLService.filename({ invoiceType: "PURCHASE", invoiceNumber: "0001234" }))
      .toBe("factura-compra-0001234.xml");
  });

  it("reemplaza caracteres no alfanuméricos en el número por guión bajo", () => {
    expect(SeniatXMLService.filename({ invoiceType: "SALE", invoiceNumber: "001/234" }))
      .toBe("factura-venta-001_234.xml");
  });
});

// ─── qrContent() ──────────────────────────────────────────────────────────────

describe("SeniatXMLService.qrContent", () => {
  it("genera contenido QR con todos los campos", () => {
    const content = SeniatXMLService.qrContent({
      companyRif: "J-12345678-9",
      invoiceNumber: "0001234",
      controlNumber: "00-0001234",
      date: new Date("2026-04-07T00:00:00.000Z"),
      currency: "VES",
      montoTotal: "1160.00",
    });
    expect(content).toBe(
      "CONTAFLOW:RIF=J-12345678-9;FACTURA=0001234;CONTROL=00-0001234;TOTAL=1160.00;FECHA=2026-04-07;MONEDA=VES"
    );
  });

  it("omite CONTROL si controlNumber es null", () => {
    const content = SeniatXMLService.qrContent({
      companyRif: "J-12345678-9",
      invoiceNumber: "0001234",
      controlNumber: null,
      date: new Date("2026-04-07T00:00:00.000Z"),
      currency: "USD",
      montoTotal: "100.00",
    });
    expect(content).toContain("CONTAFLOW:");
    expect(content).not.toContain("CONTROL=");
    expect(content).toContain("MONEDA=USD");
  });
});
