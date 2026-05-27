// src/lib/digital-invoice/DigitalInvoiceFactory.ts
// Resuelve qué provider usar según la configuración de la empresa.
// ADR-031

import { createDecipheriv } from "crypto";
import type { DigitalInvoiceProvider } from "./provider.types";
import { NullDigitalInvoiceProvider } from "./providers/null.provider";
import { MockDigitalInvoiceProvider } from "./providers/mock.provider";
import { HKADigitalInvoiceProvider } from "./providers/hka/hka.provider";

export type ProviderType = "NONE" | "HKA";

interface CompanyProviderConfig {
  provider:           ProviderType;
  apiKeyEnc?:         string | null; // AES-256-GCM cifrado con CERT_ENCRYPTION_SECRET
}

// ─── Descifrado de credenciales ───────────────────────────────────────────────

function decryptApiKey(encrypted: string): string {
  const secret = process.env.CERT_ENCRYPTION_SECRET;
  if (!secret) throw new Error("CERT_ENCRYPTION_SECRET no configurado");

  // Formato: iv(24 hex) + ":" + authTag(32 hex) + ":" + ciphertext(hex)
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Formato de clave cifrada inválido");

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key        = Buffer.from(secret.slice(0, 64).padEnd(64, "0"), "hex");
  const iv         = Buffer.from(ivHex, "hex");
  const authTag    = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const apiKey = decrypted.toString("utf8");
  decrypted.fill(0); // limpiar buffer en memoria
  return apiKey;
}

// ─── HKA base URL por entorno ─────────────────────────────────────────────────

function getHKABaseUrl(): string {
  // TODO: confirmar URL oficial cuando recibamos documentación de HKA
  return process.env.HKA_API_URL ?? "https://api.thefactoryhka.com/v1";
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDigitalInvoiceProvider(
  config: CompanyProviderConfig,
): DigitalInvoiceProvider | null {
  if (process.env.NODE_ENV === "test") {
    return new MockDigitalInvoiceProvider();
  }

  if (config.provider === "NONE") {
    return null; // La empresa no usa facturación digital — flujo interno
  }

  if (config.provider === "HKA") {
    if (!config.apiKeyEnc) {
      throw new Error("HKA configurado pero sin API key. Configura digitalInvoiceApiKeyEnc.");
    }
    const apiKey = decryptApiKey(config.apiKeyEnc);
    return new HKADigitalInvoiceProvider({
      apiKey,
      baseUrl: getHKABaseUrl(),
    });
  }

  return null;
}

// ─── Utilidad para tests ──────────────────────────────────────────────────────

export function createMockProvider(options?: ConstructorParameters<typeof MockDigitalInvoiceProvider>[0]) {
  return new MockDigitalInvoiceProvider(options);
}

export function createNullProvider() {
  return new NullDigitalInvoiceProvider();
}
