// src/instrumentation-client.ts
//
// Punto de arranque del CLIENTE: Next ejecuta este módulo antes que el código de
// la aplicación. Es el único sitio donde la configuración global alcanza a correr
// antes del primer `.parse()` de Zod.

import * as Sentry from "@sentry/nextjs";
import { config } from "zod";

// Zod 4 compila los esquemas con `new Function` (JIT) para validar más rápido, y
// antes de usarlo hace una sonda: `try { new Function("") } catch { … }`.
//
// Nuestra CSP no permite 'unsafe-eval' (fix MEDIUM-1), así que la sonda SIEMPRE
// falla en el navegador. Zod la atrapa y cae al camino interpretado — nada se
// rompe — pero el navegador igual reporta la excepción atrapada como una
// violación `script-src` de disposición "enforce". Ese ruido en consola tapa
// violaciones reales, que es justo lo que no queremos al auditar la CSP.
//
// `jitless: true` hace que Zod ni siquiera intente la sonda. Coste real: CERO,
// porque bajo esta CSP el JIT ya era inalcanzable. Lo dice su propia doc:
// "Disable JIT schema compilation. Useful in environments that disallow `eval`."
//
// IMPORTANTE — solo cliente, deliberadamente: en el servidor NO hay CSP, ahí el
// JIT sí funciona y es más rápido. Ponerlo global (p.ej. en zod-helpers.ts, que
// además solo importan 20 de 43 schemas) penalizaría la validación del servidor
// sin ganar nada.
config({ jitless: true });

// OBLIGATORIO desde que existe este archivo: en cuanto Next detecta un
// `instrumentation-client.ts`, el SDK de Sentry deja de instrumentar las
// navegaciones a menos que se exporte este hook desde aquí. Sin él se pierde el
// rastreo de cambios de ruta en el cliente (el build lo avisa con
// "ACTION REQUIRED: ... onRouterTransitionStart"). La inicialización de Sentry
// sigue viviendo en sentry.client.config.ts.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
