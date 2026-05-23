// src/lib/email.ts
// Servicio de email via Resend REST API — sin dependencia npm, usa fetch nativo.
// Degradación graceful: si RESEND_API_KEY no está configurado, loguea y retorna ok=false.
//
// Variables requeridas:
//   RESEND_API_KEY    — Resend Dashboard → API Keys
//   RESEND_FROM       — Dirección remitente verificada en Resend (ej: notificaciones@contaflow.com.ve)
//                       Si no se define, usa "ContaFlow <notificaciones@contaflow.app>"

const RESEND_API = "https://api.resend.com/emails";

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[EmailService] RESEND_API_KEY no configurado — email no enviado:", payload.subject);
    return { ok: false, error: "RESEND_API_KEY no configurado" };
  }

  const from = process.env.RESEND_FROM ?? "ContaFlow <notificaciones@contaflow.app>";

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(sin respuesta)");
      console.error("[EmailService] Error Resend:", res.status, body);
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    const data = await res.json() as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EmailService] Error de red:", msg);
    return { ok: false, error: msg };
  }
}
