// src/lib/__tests__/sign-in-redirect.test.ts
//
// Contexto: en producción toda ruta protegida devolvía un 404 pelado a los
// visitantes sin sesión porque `auth.protect()` no podía resolver la signInUrl de
// Clerk (llegaba vacía). El middleware ahora pasa la URL explícita; estos tests
// fijan cómo se construye, sobre todo la propiedad anti-open-redirect.

import { describe, it, expect } from "vitest";
import { buildSignInUrl } from "../sign-in-redirect";

const ORIGIN = "https://contaflow-rho.vercel.app";

describe("buildSignInUrl", () => {
  it("apunta a /sign-in en el mismo origen del request", () => {
    const url = new URL(buildSignInUrl(`${ORIGIN}/dashboard`, "/dashboard", ""));
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/sign-in");
  });

  it("preserva el destino original en redirect_url", () => {
    const url = new URL(buildSignInUrl(`${ORIGIN}/dashboard`, "/dashboard", ""));
    expect(url.searchParams.get("redirect_url")).toBe("/dashboard");
  });

  it("preserva la query string del destino", () => {
    const url = new URL(
      buildSignInUrl(`${ORIGIN}/company/abc/invoices?page=2`, "/company/abc/invoices", "?page=2"),
    );
    expect(url.searchParams.get("redirect_url")).toBe("/company/abc/invoices?page=2");
  });

  it("funciona en localhost (dev) sin fijar el host", () => {
    const url = new URL(buildSignInUrl("http://localhost:3000/budgets", "/budgets", ""));
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/sign-in");
  });

  // INVARIANTE DE SEGURIDAD: redirect_url siempre es una ruta relativa derivada del
  // request, nunca un destino externo. Si alguien lo cablea a un query param
  // entrante, esto pasa a ser un open redirect y este test debe fallar.
  it("no permite un destino externo aunque venga en la query del request", () => {
    const url = new URL(
      buildSignInUrl(
        `${ORIGIN}/dashboard?redirect_url=https://evil.tld`,
        "/dashboard",
        "?redirect_url=https%3A%2F%2Fevil.tld",
      ),
    );
    // El origen del sign-in nunca cambia…
    expect(url.origin).toBe(ORIGIN);
    // …y el redirect_url resultante es una ruta relativa, no la URL del atacante.
    const dest = url.searchParams.get("redirect_url") ?? "";
    expect(dest.startsWith("/")).toBe(true);
    expect(new URL(dest, ORIGIN).origin).toBe(ORIGIN);
  });

  it("no rompe con caracteres que exigen encoding", () => {
    const url = new URL(
      buildSignInUrl(`${ORIGIN}/company/a b`, "/company/a b", "?q=x%20y&n=1"),
    );
    expect(url.searchParams.get("redirect_url")).toBe("/company/a b?q=x%20y&n=1");
  });
});
