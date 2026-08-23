// src/lib/__tests__/portal-secret.test.ts
// Invariante: los TRES firmadores de portales señalan la falta de secreto con
// MissingPortalSecretError, no con un Error genérico.
//
// De esto depende que las actions puedan distinguir "falta configuración" de
// cualquier otro fallo. Si alguien vuelve a `new Error(...)`, las actions
// dejarían de traducirlo: en producción eso significó una página caída y el
// nombre de la variable de entorno filtrado al cliente (2026-08-23).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signEmployeeToken } from "@/lib/employee-portal-jwt";
import { signClientToken } from "@/lib/client-portal-jwt";
import { signDocShareToken, verifyDocShareToken } from "@/lib/document-share-jwt";
import { MissingPortalSecretError, isMissingPortalSecret } from "@/lib/portal-secret";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EMPLOYEE_PORTAL_SECRET", "");
  vi.stubEnv("DOC_SHARE_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secreto ausente en producción", () => {
  it("signEmployeeToken lanza MissingPortalSecretError con la variable correcta", () => {
    try {
      signEmployeeToken("emp-1", "co-1");
      expect.unreachable("debió lanzar");
    } catch (err) {
      expect(isMissingPortalSecret(err)).toBe(true);
      expect((err as MissingPortalSecretError).envVar).toBe("EMPLOYEE_PORTAL_SECRET");
    }
  });

  it("signClientToken lanza MissingPortalSecretError", () => {
    try {
      signClientToken("cust-1", "co-1");
      expect.unreachable("debió lanzar");
    } catch (err) {
      expect(isMissingPortalSecret(err)).toBe(true);
      expect((err as MissingPortalSecretError).envVar).toBe("EMPLOYEE_PORTAL_SECRET");
    }
  });

  it("signDocShareToken lanza MissingPortalSecretError", () => {
    try {
      signDocShareToken("INVOICE", "inv-1", "co-1");
      expect.unreachable("debió lanzar");
    } catch (err) {
      expect(isMissingPortalSecret(err)).toBe(true);
      expect((err as MissingPortalSecretError).envVar).toBe("DOC_SHARE_SECRET");
    }
  });
});

describe("con secreto configurado", () => {
  beforeEach(() => {
    vi.stubEnv("EMPLOYEE_PORTAL_SECRET", "un-secreto-de-pruebas-de-32-chars!!");
  });

  it("firma sin lanzar", () => {
    expect(signEmployeeToken("emp-1", "co-1").split(".")).toHaveLength(3);
    expect(signClientToken("cust-1", "co-1").split(".")).toHaveLength(3);
    // document-share cae en fallback a EMPLOYEE_PORTAL_SECRET cuando no hay DOC_SHARE_SECRET
    expect(signDocShareToken("INVOICE", "inv-1", "co-1").token.split(".")).toHaveLength(3);
  });
});

describe("isMissingPortalSecret", () => {
  it("no confunde otros errores", () => {
    expect(isMissingPortalSecret(new Error("EMPLOYEE_PORTAL_SECRET is required in production"))).toBe(false);
    expect(isMissingPortalSecret(null)).toBe(false);
    expect(isMissingPortalSecret("texto")).toBe(false);
  });
});

describe("DOC_SHARE_SECRET declarada pero vacía", () => {
  // Regresión: con `??` en la cadena de fallback, "" no es nullish y cortaba el
  // salto a EMPLOYEE_PORTAL_SECRET — compartir documentos se caía en producción
  // por una línea vacía en el panel de entorno.
  beforeEach(() => {
    vi.stubEnv("DOC_SHARE_SECRET", "");
    vi.stubEnv("EMPLOYEE_PORTAL_SECRET", "un-secreto-de-pruebas-de-32-chars!!");
  });

  it("cae al secreto de portales en vez de lanzar", () => {
    const { token, jti } = signDocShareToken("INVOICE", "inv-1", "co-1");
    const payload = verifyDocShareToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.jti).toBe(jti);
    expect(payload?.cid).toBe("co-1");
  });
});
