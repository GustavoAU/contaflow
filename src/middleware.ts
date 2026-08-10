import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { buildSignInUrl } from "@/lib/sign-in-redirect";
import { buildCsp, STYLE_SRC_ENFORCED, styleSrcObserved } from "@/lib/csp";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/monitoring(.*)",
  "/api/health",
  "/api/webhook/(.*)",
  "/api/webhooks/(.*)",
  "/employee/(.*)",      // Portal del Empleado — acceso por token JWT sin Clerk
  "/client-portal/(.*)", // Portal del Cliente — acceso por token JWT sin Clerk
  "/api/doc/(.*)",   // Q3-1: Documentos compartidos — autenticados por DOC_SHARE_SECRET JWT
  "/api/cron/(.*)",  // Vercel Cron Jobs — autenticados por CRON_SECRET, no por Clerk
]);


export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    // `auth.protect()` en middleware redirige a la signInUrl de Clerk cuando no hay
    // sesión, PERO solo si puede resolverla; si no, cae a un 404. En producción llega
    // vacía (`signInUrl:""` en el HTML servido), así que toda ruta protegida devolvía
    // un 404 pelado: indistinguible de una ruta inexistente, y el usuario cree que la
    // app se rompió al recargar con la sesión vencida. Se pasa la URL explícita para
    // no depender de una env var que puede faltar en un entorno nuevo.
    if (request.nextUrl.pathname.startsWith("/api")) {
      // En /api NO se redirige: un 302 a HTML rompería a los clientes que esperan
      // JSON (anomaly-summary, attachments/upload). Ahí el 404 de Clerk es correcto.
      await auth.protect();
    } else {
      // Devuelve al usuario a donde iba tras autenticarse. `<SignIn />` honra
      // `redirect_url` sin configuración extra. Ver la invariante de open redirect
      // documentada en buildSignInUrl.
      await auth.protect({
        unauthenticatedUrl: buildSignInUrl(
          request.url,
          request.nextUrl.pathname,
          request.nextUrl.search,
        ),
      });
    }
  }

  // Generate a fresh cryptographic nonce for each request (Edge-compatible Web Crypto).
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  // x-nonce on the REQUEST side lets Server Components and Next.js internals read
  // the nonce during SSR so they can stamp it on generated <script> tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const isDev = process.env.NODE_ENV === "development";
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce, STYLE_SRC_ENFORCED, isDev));
  // I-1: política estricta de estilos en observación. No bloquea nada; el navegador
  // reporta las violaciones para saber exactamente qué inyecta <style> antes de
  // aplicarla. Ver los comentarios de styleSrcObserved en @/lib/csp.
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    buildCsp(nonce, styleSrcObserved(nonce), isDev),
  );

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
