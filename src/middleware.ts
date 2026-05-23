import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/monitoring(.*)",
  "/api/health",
  "/api/webhook/(.*)",
  "/api/webhooks/(.*)",
  "/employee/(.*)",  // Portal del Empleado — acceso por token JWT sin Clerk
]);

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // nonce + strict-dynamic: modern browsers honour the nonce; strict-dynamic
    // lets trusted scripts load further scripts without whitelisting every CDN.
    // unsafe-inline is intentionally absent — MEDIUM-1 fix.
    `script-src 'nonce-${nonce}' 'strict-dynamic' https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev https://*.sentry.io https://*.ingest.sentry.io https://*.upstash.io https://generativelanguage.googleapis.com https://api.nowpayments.io${isDev ? " ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:*" : ""}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  // Generate a fresh cryptographic nonce for each request (Edge-compatible Web Crypto).
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp(nonce);

  // x-nonce on the REQUEST side lets Server Components and Next.js internals read
  // the nonce during SSR so they can stamp it on generated <script> tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
});

export const config = {
  matcher: [
    // Proteger todas las rutas excepto archivos estáticos de Next.js
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Siempre ejecutar para rutas de API
    "/(api|trpc)(.*)",
  ],
};
