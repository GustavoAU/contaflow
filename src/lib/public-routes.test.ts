// src/lib/public-routes.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { createRouteMatcher } from "@clerk/nextjs/server";
import { PUBLIC_ROUTE_PATTERNS } from "./public-routes";

const isPublic = createRouteMatcher(PUBLIC_ROUTE_PATTERNS);
const at = (path: string) => new NextRequest(`https://contaflow.test${path}`, { method: "POST" });

describe("PUBLIC_ROUTE_PATTERNS", () => {
  it("deja pasar el callback de Vercel Blob (sin sesión) hasta la ruta de adjuntos", () => {
    // Si falta, Clerk lo reescribe a "no encontrado" con 200 y onUploadCompleted nunca corre.
    expect(isPublic(at("/api/payments/attachments/upload"))).toBe(true);
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
