// src/lib/sign-in-redirect.ts
//
// Construye la URL de sign-in a la que el middleware manda a un visitante sin
// sesión. Vive fuera de `src/middleware.ts` porque ese archivo ejecuta
// `clerkMiddleware()` al importarse — no se puede testear sin levantar Clerk.

/**
 * URL absoluta de `/sign-in` en el MISMO origen del request, con el destino
 * original en `redirect_url` para que Clerk devuelva al usuario ahí.
 *
 * INVARIANTE DE SEGURIDAD: `redirect_url` se arma con el pathname + search del
 * request en curso, jamás con un valor que venga del usuario. Si algún día se
 * lee de un query param entrante, esto se convierte en un open redirect
 * (atacante manda /dashboard?redirect_url=https://evil.tld y Clerk lo obedece).
 * El test `sign-in-redirect.test.ts` fija esta propiedad.
 *
 * @param requestUrl URL del request en curso — define el origen del resultado
 * @param pathname   ruta solicitada (ej. "/dashboard")
 * @param search     query string con "?" incluido, o "" si no hay
 */
export function buildSignInUrl(
  requestUrl: string | URL,
  pathname: string,
  search: string,
): string {
  const url = new URL("/sign-in", requestUrl);
  url.searchParams.set("redirect_url", `${pathname}${search}`);
  return url.toString();
}
