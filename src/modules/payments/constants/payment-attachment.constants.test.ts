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
});
