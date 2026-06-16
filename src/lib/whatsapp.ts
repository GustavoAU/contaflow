// src/lib/whatsapp.ts
// Servicio de WhatsApp via Meta Cloud API — stub enchufable.
// Degradación graceful: si no hay credenciales configuradas, loguea y retorna ok=false
// (no-op). El sistema funciona sin WhatsApp; se activa con solo poner las env vars.
//
// Variables requeridas para ACTIVAR (obtenerlas en Meta Business / WhatsApp Cloud API):
//   WHATSAPP_PHONE_NUMBER_ID  — ID del número emisor (Meta Cloud API)
//   WHATSAPP_ACCESS_TOKEN     — token permanente del System User de Meta
//   WHATSAPP_API_VERSION      — opcional, default "v21.0"
//
// Nota: Meta exige plantillas (templates) preaprobadas para mensajes proactivos
// fuera de la ventana de 24h. `templateName` debe existir y estar aprobado en Meta.

const META_GRAPH = "https://graph.facebook.com";

export interface WhatsAppTemplatePayload {
  /** Teléfono destino en formato E.164 sin "+", ej: "584121234567" */
  to: string;
  /** Nombre del template aprobado en Meta, ej: "renovacion_recordatorio" */
  templateName: string;
  /** Código de idioma del template, ej: "es" */
  languageCode?: string;
  /** Parámetros del cuerpo del template, en orden ({{1}}, {{2}}, ...) */
  bodyParams?: string[];
}

export interface WhatsAppResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

export async function sendWhatsAppTemplate(
  payload: WhatsAppTemplatePayload,
): Promise<WhatsAppResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";

  // Stub: sin credenciales → no-op silencioso (no rompe el flujo de recordatorios)
  if (!phoneNumberId || !token) {
    console.warn(
      "[WhatsAppService] Credenciales no configuradas — WhatsApp no enviado:",
      payload.templateName,
    );
    return { ok: false, skipped: true, error: "WhatsApp no configurado" };
  }

  try {
    const res = await fetch(`${META_GRAPH}/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: payload.to,
        type: "template",
        template: {
          name: payload.templateName,
          language: { code: payload.languageCode ?? "es" },
          ...(payload.bodyParams && payload.bodyParams.length > 0
            ? {
                components: [
                  {
                    type: "body",
                    parameters: payload.bodyParams.map((text) => ({ type: "text", text })),
                  },
                ],
              }
            : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(sin respuesta)");
      console.error("[WhatsAppService] Error Meta:", res.status, body);
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { messages?: { id?: string }[] };
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[WhatsAppService] Error de red:", msg);
    return { ok: false, error: msg };
  }
}
