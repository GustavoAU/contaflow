/**
 * CertificateService — Fase 35I (ADR-020)
 *
 * Gestiona certificados X.509 por empresa para firma digital de documentos fiscales.
 * Modelo híbrido: autofirmado (demo, $0) + .p12 oficial (PSC World / SUSCERTE).
 *
 * Zonas de Peligro (Z-5):
 *   - encryptedP12 NUNCA se retorna al cliente — usar SELECT explícito siempre
 *   - La clave privada NUNCA toca disco — se procesa completamente en memoria
 *   - buf.fill(0) obligatorio post-descifrado en el caller
 */

import crypto from "node:crypto";
import forge from "node-forge";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CertificateStatusDTO {
  exists: boolean;
  thumbprint?: string;
  issuedBy?: string;
  expiresAt?: Date;
  isSelfSigned?: boolean;
  daysUntilExpiry?: number;
  warningExpiringSoon?: boolean; // true si daysUntilExpiry <= 30
}

interface GeneratedCert {
  p12Buffer: Buffer;
  thumbprint: string;
  commonName: string;
  serialNumber: string;
  issuedBy: string;
  expiresAt: Date;
}

// ─── Utilidades de cifrado AES-256-GCM ───────────────────────────────────────

function deriveKey(companyId: string): Buffer {
  const secret = process.env.CERT_ENCRYPTION_SECRET;
  if (!secret) throw new Error("CERT_ENCRYPTION_SECRET is required");
  // HMAC-SHA256(key=secret, data=companyId) avoids concatenation canonicalization
  return crypto.createHmac("sha256", secret).update(companyId).digest();
}

function encryptP12(p12Buffer: Buffer, companyId: string): Buffer {
  const key = deriveKey(companyId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(p12Buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout: [IV(12)] [AuthTag(16)] [Encrypted(N)]
  return Buffer.concat([iv, authTag, encrypted]);
}

/** Descifra el PKCS#12. El caller DEBE llamar buf.fill(0) cuando termine. */
export function decryptCertificate(encryptedBuffer: Buffer, companyId: string): Buffer {
  const key = deriveKey(companyId);
  const iv = encryptedBuffer.subarray(0, 12);
  const authTag = encryptedBuffer.subarray(12, 28);
  const encrypted = encryptedBuffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ─── Generación interna de certificado autofirmado ───────────────────────────

function buildSelfSignedCert(companyName: string, rif: string): GeneratedCert {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 2);

  const attrs = [
    { name: "commonName", value: companyName },
    { name: "organizationName", value: companyName },
    { shortName: "OU", value: rif },
    { name: "countryName", value: "VE" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);

  cert.sign(keypair.privateKey, forge.md.sha256.create());

  // PKCS#12 en memoria — sin contraseña (la protección es el cifrado AES del sistema)
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keypair.privateKey, [cert], "", {
    generateLocalKeyId: true,
    friendlyName: companyName,
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  // Thumbprint = SHA-256 del DER del certificado
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const thumbprint = crypto
    .createHash("sha256")
    .update(Buffer.from(certDer, "binary"))
    .digest("hex");

  return {
    p12Buffer,
    thumbprint,
    commonName: companyName,
    serialNumber: cert.serialNumber,
    issuedBy: companyName,
    expiresAt: cert.validity.notAfter,
  };
}

// ─── Servicio principal ───────────────────────────────────────────────────────

export class CertificateService {
  /**
   * Genera un certificado autofirmado RSA-2048 para la empresa.
   * Debe llamarse dentro de un $transaction activo (R-6: AuditLog en mismo tx).
   */
  static async generateSelfSigned(
    tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
    companyId: string,
    companyName: string,
    rif: string,
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    // Rechazar si ya existe certificado
    const existing = await tx.companyCertificate.findUnique({
      where: { companyId },
      select: { id: true },
    });
    if (existing) {
      throw new Error("La empresa ya tiene un certificado activo. Use cargar para reemplazarlo.");
    }

    const generated = buildSelfSignedCert(companyName, rif ?? "");
    const encryptedP12 = Uint8Array.from(encryptP12(generated.p12Buffer, companyId));

    // Limpiar la clave privada en memoria
    generated.p12Buffer.fill(0);

    const certificate = await tx.companyCertificate.create({
      data: {
        companyId,
        commonName: generated.commonName,
        serialNumber: generated.serialNumber,
        encryptedP12,
        thumbprint: generated.thumbprint,
        issuedBy: generated.issuedBy,
        expiresAt: generated.expiresAt,
        isSelfSigned: true,
        createdBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "CERTIFICATE_GENERATED",
        entityName: "CompanyCertificate",
        entityId: certificate.id,
        newValue: {
          thumbprint: generated.thumbprint,
          isSelfSigned: true,
          expiresAt: generated.expiresAt.toISOString(),
        } as unknown as Prisma.InputJsonValue,
        ipAddress,
        userAgent,
      },
    });

    return {
      thumbprint: generated.thumbprint,
      expiresAt: generated.expiresAt,
      isSelfSigned: true as const,
    };
  }

  /**
   * Carga un certificado oficial .p12 emitido por proveedor acreditado.
   * Valida la estructura PKCS#12 antes de cifrar.
   * Debe llamarse dentro de un $transaction activo.
   */
  static async loadOfficialCertificate(
    tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
    companyId: string,
    p12Buffer: Buffer,
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    // Validar estructura PKCS#12 antes de cifrar
    let commonName: string;
    let serialNumber: string;
    let issuedBy: string;
    let expiresAt: Date;
    let thumbprint: string;

    try {
      const p12Der = forge.util.createBuffer(p12Buffer.toString("binary"));
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, "");

      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag = certBags[forge.pki.oids.certBag]?.[0];
      if (!certBag?.cert) throw new Error("No se encontró certificado en el archivo .p12");

      const cert = certBag.cert;
      commonName = cert.subject.getField("CN")?.value ?? "Desconocido";
      serialNumber = cert.serialNumber;
      issuedBy = cert.issuer.getField("CN")?.value ?? "Desconocido";
      expiresAt = cert.validity.notAfter;

      const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      thumbprint = crypto
        .createHash("sha256")
        .update(Buffer.from(certDer, "binary"))
        .digest("hex");
    } catch (err) {
      throw new Error(
        `El archivo .p12 no es válido o está dañado: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const encryptedP12 = Uint8Array.from(encryptP12(p12Buffer, companyId));

    // Upsert: una empresa = un certificado activo
    const certificate = await tx.companyCertificate.upsert({
      where: { companyId },
      create: {
        companyId,
        commonName,
        serialNumber,
        encryptedP12,
        thumbprint,
        issuedBy,
        expiresAt,
        isSelfSigned: false,
        createdBy: userId,
      },
      update: {
        commonName,
        serialNumber,
        encryptedP12,
        thumbprint,
        issuedBy,
        expiresAt,
        isSelfSigned: false,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "CERTIFICATE_LOADED",
        entityName: "CompanyCertificate",
        entityId: certificate.id,
        newValue: {
          thumbprint,
          isSelfSigned: false,
          issuedBy,
          expiresAt: expiresAt.toISOString(),
        } as unknown as Prisma.InputJsonValue,
        ipAddress,
        userAgent,
      },
    });

    return { thumbprint, expiresAt, issuedBy, isSelfSigned: false as const };
  }

  /**
   * Retorna el estado público del certificado.
   * SELECT explícito — encryptedP12 NUNCA incluido (Z-5).
   */
  static async getCertificateStatus(companyId: string): Promise<CertificateStatusDTO> {
    const cert = await prisma.companyCertificate.findUnique({
      where: { companyId },
      select: {
        thumbprint: true,
        issuedBy: true,
        expiresAt: true,
        isSelfSigned: true,
      },
    });

    if (!cert) return { exists: false };

    const now = new Date();
    const daysUntilExpiry = Math.floor(
      (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      exists: true,
      thumbprint: cert.thumbprint,
      issuedBy: cert.issuedBy,
      expiresAt: cert.expiresAt,
      isSelfSigned: cert.isSelfSigned,
      daysUntilExpiry,
      warningExpiringSoon: daysUntilExpiry <= 30,
    };
  }
}
