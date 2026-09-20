// src/lib/public-routes.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { createRouteMatcher } from "@clerk/nextjs/server";
import { PUBLIC_ROUTE_PATTERNS } from "./public-routes";

const isPublic = createRouteMatcher(PUBLIC_ROUTE_PATTERNS);
const at = (path: string) => new NextRequest(`https://contaflow.test${path}`, { method: "POST" });

describe("PUBLIC_ROUTE_PATTERNS", () => {
  it("la subida y la descarga de comprobantes NO son públicas: van con sesión de Clerk (ADR-047)", () => {
    // Ya no hay callback de Vercel Blob: el servidor recibe el archivo y lo guarda él mismo.
    expect(isPublic(at("/api/payments/attachments/upload"))).toBe(false);
    expect(isPublic(at("/api/company/c1/payments/attachments/a1/download"))).toBe(false);
  });

  it("mantiene públicas las rutas que ya se autentican por otro medio", () => {
    for (const path of [
      "/",
      "/sign-in",
      "/api/health",
      "/api/webhooks/seniat-report",
      "/api/cron/daily-notifications",
      "/api/doc/token123",
      "/employee/token123",
      "/client-portal/token123",
    ]) {
      expect(isPublic(at(path)), path).toBe(true);
    }
  });

  it("no abre nada más de pagos ni del resto de la API", () => {
    for (const path of [
      "/api/payments/attachments",
      "/api/payments/attachments/upload/otra",
      "/api/payments/other",
      "/api/company/c1/anomaly-summary",
      "/dashboard",
    ]) {
      expect(isPublic(at(path)), path).toBe(false);
    }
  });
});
