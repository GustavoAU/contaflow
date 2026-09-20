// src/modules/payments/constants/payment-attachment.constants.test.ts
import { describe, it, expect } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
  attachmentDownloadPath,
  buildAttachmentPathname,
  detectAttachmentMime,
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

  it("con el tipo declarado, la extensión de la ruta debe ser la de ese tipo", () => {
    const png = buildAttachmentPathname("co-1", "pay-1", "image/png", UUID);
    expect(isValidAttachmentPathname(png, "co-1", "pay-1", "image/png")).toBe(true);
    expect(isValidAttachmentPathname(png, "co-1", "pay-1", "application/pdf")).toBe(false);
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

  it("quita soft hyphen, marca de dirección árabe, etiquetas Unicode y surrogates sueltos", () => {
    const sucio =
      "a" + String.fromCodePoint(0x00ad) + "b" + String.fromCodePoint(0x061c) + "c" +
      String.fromCodePoint(0xe0041) + "d" + String.fromCharCode(0xd800) + "e.pdf";
    expect(sanitizeAttachmentFileName(sucio)).toBe("abcde.pdf");
  });
});

describe("detectAttachmentMime — el tipo sale de los bytes, no del navegador", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const webp = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

  it("reconoce PDF, JPEG, PNG y WebP", () => {
    expect(detectAttachmentMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(detectAttachmentMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectAttachmentMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectAttachmentMime(webp)).toBe("image/webp");
  });

  it("rechaza lo que no es uno de los cuatro (HTML, exe, WAV que también es RIFF, texto corto, vacío)", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(detectAttachmentMime(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectAttachmentMime(text("%PDF"))).toBeNull(); // sin el guion no es la cabecera
    expect(detectAttachmentMime(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // MZ (exe)
    expect(detectAttachmentMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // WAV
    expect(detectAttachmentMime(new Uint8Array())).toBeNull();
  });
});

describe("límites y rutas de descarga", () => {
  it("el tope cabe en el cuerpo de una Vercel Function (4,5 MB) con margen para el multipart", () => {
    expect(MAX_SIZE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_SIZE_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("la ruta de descarga va bajo la empresa, con sesión (no es la URL del blob)", () => {
    expect(attachmentDownloadPath("co-1", "att-9")).toBe("/api/company/co-1/payments/attachments/att-9/download");
  });
});
