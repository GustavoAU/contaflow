// src/modules/payments/constants/payment-attachment.constants.test.ts
import { describe, it, expect } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  buildAttachmentPathname,
  isValidAttachmentPathname,
  sanitizeAttachmentFileName,
} from "./payment-attachment.constants";

const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("buildAttachmentPathname / isValidAttachmentPathname", () => {
  it.each(ALLOWED_MIME_TYPES)("la ruta que arma el cliente para %s pasa la validación del servidor", (mime) => {
    const pathname = buildAttachmentPathname("co-1", "pay-1", mime, UUID);
    expect(pathname.startsWith("co-1/payments/pay-1/")).toBe(true);
    expect(isValidAttachmentPathname(pathname, "co-1", "pay-1")).toBe(true);
  });

  it("no acepta la misma ruta bajo otra empresa o pago", () => {
    const pathname = buildAttachmentPathname("co-1", "pay-1", "application/pdf", UUID);
    expect(isValidAttachmentPathname(pathname, "co-2", "pay-1")).toBe(false);
    expect(isValidAttachmentPathname(pathname, "co-1", "pay-2")).toBe(false);
  });

  it("no acepta el nombre suelto de un archivo, ni un segmento que no sea UUID", () => {
    expect(isValidAttachmentPathname("comprobante.pdf", "co-1", "pay-1")).toBe(false);
    expect(isValidAttachmentPathname("co-1/payments/pay-1/comprobante.pdf", "co-1", "pay-1")).toBe(false);
  });

  it("no acepta mayúsculas: el cliente siempre genera uuid y extensión en minúsculas", () => {
    const upper = `co-1/payments/pay-1/${UUID.toUpperCase()}.pdf`;
    const upperExt = `co-1/payments/pay-1/${UUID}.PDF`;
    expect(isValidAttachmentPathname(upper, "co-1", "pay-1")).toBe(false);
    expect(isValidAttachmentPathname(upperExt, "co-1", "pay-1")).toBe(false);
  });
});

describe("sanitizeAttachmentFileName", () => {
  it("conserva un nombre normal", () => {
    expect(sanitizeAttachmentFileName("comprobante-zelle.pdf")).toBe("comprobante-zelle.pdf");
  });

  it("quita separadores de ruta y caracteres de control", () => {
    const sucio = "a/b" + String.fromCharCode(92) + "c" + String.fromCharCode(0) + "d" + String.fromCharCode(31) + ".pdf";
    expect(sanitizeAttachmentFileName(sucio)).toBe("abcd.pdf");
  });

  it("trunca a 200 caracteres", () => {
    expect(sanitizeAttachmentFileName("x".repeat(500))).toHaveLength(200);
  });

  it("usa un nombre por defecto si queda vacío o no llega", () => {
    expect(sanitizeAttachmentFileName(undefined)).toBe("comprobante");
    expect(sanitizeAttachmentFileName("   ")).toBe("comprobante");
    expect(sanitizeAttachmentFileName("///")).toBe("comprobante");
  });

  it("no acepta algo que no sea string (un array conservaría saltos de línea)", () => {
    expect(sanitizeAttachmentFileName(["a/../b" + String.fromCharCode(10) + "X"])).toBe("comprobante");
    expect(sanitizeAttachmentFileName({ toString: () => "x" })).toBe("comprobante");
    expect(sanitizeAttachmentFileName(42)).toBe("comprobante");
  });

  it("quita caracteres bidi e invisibles (RLO, zero-width, BOM)", () => {
    const sucio = "a" + String.fromCodePoint(0x202e) + "b" + String.fromCodePoint(0x200b) + "c" + String.fromCodePoint(0xfeff) + ".pdf";
    expect(sanitizeAttachmentFileName(sucio)).toBe("abc.pdf");
  });

  it("al truncar no parte un carácter fuera del plano básico (emoji)", () => {
    const largo = "x".repeat(199) + String.fromCodePoint(0x1f600) + "y";
    const limpio = sanitizeAttachmentFileName(largo);
    expect(Array.from(limpio)).toHaveLength(200);
    expect(limpio.endsWith(String.fromCodePoint(0x1f600))).toBe(true);
  });
});
