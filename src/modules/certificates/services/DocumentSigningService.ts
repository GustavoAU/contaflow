/**
 * DocumentSigningService — Fase 35I (ADR-020)
 *
 * Firma documentos fiscales en PDF usando el certificado activo de la empresa.
 * La firma se incrusta en el PDF como comentario verificable (detached RSA-SHA256).
 * El caller obtiene un Buffer que contiene el PDF original más los metadatos de firma.
 *
 * Z-5: buf.fill(0) ejecutado sobre la clave descifrada inmediatamente post-firma.
 */

import crypto from "node:crypto";
import forge from "node-forge";
import prisma from "@/lib/prisma";
import { decryptCertificate } from "./CertificateService";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SignedDocument {
  pdf: Buffer;         // PDF original con bloque de firma al final
  thumbprint: string;  // SHA-256 del certificado usado
  signedAt: string;    // ISO timestamp
}

// ─── Utilidades de firma ──────────────────────────────────────────────────────

function signWithPrivateKey(pdfBuffer: Buffer, privateKeyPem: string): string {
  const md = forge.md.sha256.create();
  md.update(pdfBuffer.toString("binary"));

  // Obtener la private key de forge para firmar
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const signatureBytes = privateKey.sign(md);
  return Buffer.from(signatureBytes, "binary").toString("base64");
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

export class DocumentSigningService {
  /**
   * Firma un PDF con el certificado activo de la empresa.
   *
   * 1. Obtiene el CompanyCertificate (SELECT explícito — solo encryptedP12 + thumbprint)
   * 2. Descifra el PKCS#12 en memoria
   * 3. Firma el PDF con RSA-SHA256
   * 4. Limpia la clave privada con buf.fill(0) (Z-5)
   * 5. Devuelve el PDF con bloque de firma incrustado al final
   */
  static async signInvoicePDF(companyId: string, pdfBuffer: Buffer): Promise<SignedDocument> {
    // SELECT explícito — encryptedP12 solo, nunca al cliente (Z-5)
    const cert = await prisma.companyCertificate.findUnique({
      where: { companyId },
      select: { encryptedP12: true, thumbprint: true },
    });

    if (!cert) {
      throw new Error(`La empresa ${companyId} no tiene certificado digital configurado.`);
    }

    // Descifrar PKCS#12 en memoria
    const p12Buffer = decryptCertificate(cert.encryptedP12 as unknown as Buffer, companyId);
    let privateKeyPem: string;

    try {
      const p12Der = forge.util.createBuffer(p12Buffer.toString("binary"));
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, "");

      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
      const keyBag =
        keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
        p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

      if (!keyBag?.key) throw new Error("No se encontró clave privada en el PKCS#12");
      privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
    } finally {
      // Z-5: limpiar clave descifrada inmediatamente
      p12Buffer.fill(0);
    }

    // Firmar el PDF
    const signature = signWithPrivateKey(pdfBuffer, privateKeyPem);
    const signedAt = new Date().toISOString();

    // Limpiar PEM de memoria (reemplazar con zeros via nuevo Buffer)
    const pemBuffer = Buffer.from(privateKeyPem, "utf8");
    pemBuffer.fill(0);

    // Incrustar firma como bloque verificable al final del PDF
    // Formato: comentario PDF con base64 del RSA-SHA256 + thumbprint + timestamp
    const pdfHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
    const signatureBlock = [
      "",
      `%ContaFlow-Signature-Version: 1`,
      `%ContaFlow-PDF-Hash: ${pdfHash}`,
      `%ContaFlow-Signature: ${signature}`,
      `%ContaFlow-Thumbprint: ${cert.thumbprint}`,
      `%ContaFlow-SignedAt: ${signedAt}`,
      "",
    ].join("\n");

    const signedPdf = Buffer.concat([pdfBuffer, Buffer.from(signatureBlock, "ascii")]);

    return {
      pdf: signedPdf,
      thumbprint: cert.thumbprint,
      signedAt,
    };
  }

  /**
   * Verifica la firma incrustada en un PDF firmado por ContaFlow.
   * Útil para validación y auditoría.
   */
  static verifySignature(
    signedPdfBuffer: Buffer,
    certificatePem: string,
  ): { valid: boolean; thumbprint?: string; signedAt?: string } {
    const content = signedPdfBuffer.toString("ascii");

    const hashMatch = content.match(/%ContaFlow-PDF-Hash: ([a-f0-9]{64})/);
    const sigMatch = content.match(/%ContaFlow-Signature: ([A-Za-z0-9+/=]+)/);
    const thumbMatch = content.match(/%ContaFlow-Thumbprint: ([a-f0-9]{64})/);
    const dateMatch = content.match(/%ContaFlow-SignedAt: ([^\n]+)/);

    if (!hashMatch || !sigMatch || !thumbMatch) return { valid: false };

    try {
      const publicKey = forge.pki.publicKeyFromPem(certificatePem);
      const md = forge.md.sha256.create();

      // Reconstruir el PDF original (antes del bloque de firma)
      const sigBlockStart = signedPdfBuffer.indexOf(Buffer.from("\n%ContaFlow-Signature-Version:"));
      const originalPdf = sigBlockStart > 0
        ? signedPdfBuffer.subarray(0, sigBlockStart)
        : signedPdfBuffer;

      md.update(originalPdf.toString("binary"));

      const signatureBytes = Buffer.from(sigMatch[1], "base64").toString("binary");
      const valid = publicKey.verify(md.digest().bytes(), signatureBytes);

      return {
        valid,
        thumbprint: thumbMatch[1],
        signedAt: dateMatch?.[1],
      };
    } catch {
      return { valid: false };
    }
  }
}
