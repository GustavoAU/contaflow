// src/lib/csp.ts
//
// Construcción de la Content-Security-Policy. Vive fuera de `src/middleware.ts`
// porque ese archivo ejecuta `clerkMiddleware()` al importarse y no se puede
// testear sin levantar Clerk. Una CSP mal armada falla en silencio (la página
// carga, algo deja de funcionar), así que se fija con tests.

/**
 * Directivas comunes a la política aplicada y a la de observación (I-1).
 * `styleSrc` es lo único que difiere entre ambas.
 */
export function buildCsp(nonce: string, styleSrc: string[], isDev = false): string {
  return [
    "default-src 'self'",
    // nonce + strict-dynamic: los navegadores modernos honran el nonce; strict-dynamic
    // deja que un script de confianza cargue otros sin whitelistear cada CDN.
    // 'unsafe-inline' está deliberadamente ausente — fix MEDIUM-1.
    `script-src 'nonce-${nonce}' 'strict-dynamic' https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev${isDev ? " 'unsafe-eval'" : ""}`,
    ...styleSrc,
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

// ── I-1 (auditoría STRIDE 2026-07): endurecer style-src ──────────────────────
//
// Estado medido en producción (2026-08-09): el HTML servido tiene CERO elementos
// `<style>` — todo el CSS entra por `<link rel=stylesheet>` — pero SÍ 49 atributos
// `style="…"` en la landing (los degradados del hero) y 2 en /sign-in.
//
// CSP3 permite separar ambos casos, y esa separación es la que aporta seguridad:
//   - style-src-elem gobierna `<style>` y `<link>`. Es el vector peligroso: un
//     `<style>` inyectado puede usar selectores de atributo + `background:url()`
//     para exfiltrar valores de formulario (RIF, montos) a un dominio externo.
//   - style-src-attr gobierna `style="…"`. Solo afecta al elemento que lo lleva y
//     React escapa el contenido, así que el riesgo residual es mucho menor.
//
// Quitar 'unsafe-inline' de golpe NO es viable: los 49 atributos dejarían de
// aplicarse y el hero se vería roto.

/** Política APLICADA hoy. Permisiva con estilos inline — es lo que I-1 quiere cerrar. */
export const STYLE_SRC_ENFORCED = ["style-src 'self' 'unsafe-inline'"];

/**
 * Política ESTRICTA, publicada en Report-Only mientras se confirma qué la viola.
 *
 * Por qué todavía no se aplica: tres dependencias inyectan `<style>` en runtime y
 * quedarían bloqueadas — `react-remove-scroll` (scroll-lock de TODOS los modales
 * Radix), `sonner` (toasts) y potencialmente `recharts`. El fallo sería invisible
 * desde fuera: curl seguiría devolviendo 200 y solo se notaría en el navegador
 * (scroll roto al abrir un modal, toasts sin estilo).
 *
 * Camino a aplicarla: `react-remove-scroll` ya soporta nonce vía `__webpack_nonce__`
 * (su dependencia `get-nonce` ya está instalada), así que basta con exponer el nonce
 * al bundle cliente. Falta resolver `sonner` y verificar `recharts` en navegador.
 */
export const styleSrcObserved = (nonce: string) => [
  `style-src-elem 'self' 'nonce-${nonce}'`,
  "style-src-attr 'unsafe-inline'",
];
