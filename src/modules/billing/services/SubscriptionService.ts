// src/modules/billing/services/SubscriptionService.ts
// Ciclo de vida de la suscripción: estado (activa/vencida), recordatorios de
// renovación (7d/3d antes, email + WhatsApp) y marcado de EXPIRED.
//
// Modelo de cobro: pago manual en USDT (NOWPayments). NO hay débito automático.
// El corte por expiración es "solo lectura": ver isWriteAllowed (usado por el guard).
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { READ_ONLY_MESSAGE } from "@/lib/prisma-billing-gate";

export { READ_ONLY_MESSAGE };

const MS_PER_DAY = 86_400_000;

export interface SubscriptionState {
  hasSubscription: boolean;
  status: string | null;
  currentPeriodEnd: Date | null;
  /** Puede operar (crear/mutar). */
  isActive: boolean;
  /** Venció → solo lectura. */
  isExpired: boolean;
  /** Días hasta el vencimiento (negativo si ya venció). null si no hay suscripción. */
  daysUntilExpiry: number | null;
}

// Estado de la suscripción de una empresa.
// Sin suscripción → se considera activa (pre-billing / demo; nunca se corta).
export async function getSubscriptionState(companyId: string): Promise<SubscriptionState> {
  const sub = await prisma.subscription.findUnique({
    where: { companyId },
    select: { status: true, currentPeriodEnd: true },
  });

  if (!sub) {
    return {
      hasSubscription: false,
      status: null,
      currentPeriodEnd: null,
      isActive: true,
      isExpired: false,
      daysUntilExpiry: null,
    };
  }

  const now = Date.now();
  const end = sub.currentPeriodEnd.getTime();
  const withinPeriod = end >= now;
  // Activa: dentro del período pagado y no marcada EXPIRED. PAST_DUE con período
  // futuro (checkout en curso) NO corta; vencida o EXPIRED → solo lectura.
  const isActive = withinPeriod && sub.status !== "EXPIRED";

  return {
    hasSubscription: true,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    isActive,
    isExpired: !isActive,
    daysUntilExpiry: Math.ceil((end - now) / MS_PER_DAY),
  };
}

// Guard de escritura: true si la empresa puede crear/mutar.
// Sin suscripción → permitido (pre-billing). Con suscripción → solo si activa.
export async function isWriteAllowed(companyId: string): Promise<boolean> {
  const state = await getSubscriptionState(companyId);
  return !state.hasSubscription || state.isActive;
}

// Lanza si la empresa NO puede escribir (suscripción vencida).
// Fail-open: si la verificación falla (DB transitoria), permite — nunca bloquear
// una operación fiscal por un error de la consulta de billing.
export async function assertWriteAllowed(companyId: string): Promise<void> {
  let allowed = true;
  try {
    allowed = await isWriteAllowed(companyId);
  } catch (err) {
    console.error("[SubscriptionService] check de escritura falló — permitiendo (fail-open):", err);
    allowed = true;
  }
  if (!allowed) {
    throw new Error(READ_ONLY_MESSAGE);
  }
}

// ─── Cron lifecycle ─────────────────────────────────────────────────────────

export interface BillingLifecycleResult {
  expiredMarked: number;
  reminders7Sent: number;
  reminders3Sent: number;
  errors: string[];
}

function buildReminderHtml(companyName: string, daysLeft: number, renewUrl: string): string {
  const plural = daysLeft !== 1 ? "s" : "";
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
      <div style="background:#3b3bdb;padding:20px 28px">
        <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.3px">⚡ ContaFlow</span>
      </div>
      <div style="padding:28px;color:#1a1a2e;line-height:1.6">
        <h2 style="margin:0 0 6px;font-size:20px;color:#1a1a2e">
          Tu suscripción vence en ${daysLeft} día${plural}
        </h2>
        <p style="margin:0 0 16px;color:#4b5563">
          Estimado cliente de <strong>${companyName}</strong>, te escribimos para recordarte que
          tu suscripción a ContaFlow vence en <strong>${daysLeft} día${plural}</strong>.
        </p>
        <p style="margin:0 0 16px;color:#4b5563">
          Renueva ahora para seguir emitiendo facturas, retenciones y operando sin interrupciones.
          Tu información y reportes permanecen seguros y siempre disponibles.
        </p>
        <p style="margin:24px 0">
          <a href="${renewUrl}" style="display:inline-block;background:#3b3bdb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Renovar mi suscripción
          </a>
        </p>
        <p style="margin:16px 0 0;font-size:13px;color:#9ca3af">
          El pago se procesa de forma segura en USDT vía NOWPayments. Si ya renovaste, ignora este mensaje.
        </p>
      </div>
      <div style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb">
        <span style="font-size:12px;color:#9ca3af">ContaFlow — Sistema Contable Venezolano · Conforme a PA 121 SENIAT</span>
      </div>
    </div>
  `;
}

// Notifica a los OWNER de una empresa (email + WhatsApp si hay teléfono/credenciales).
async function notifyOwners(
  companyId: string,
  companyName: string,
  telefono: string | null,
  emails: string[],
  daysLeft: number,
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const renewUrl = `${appUrl}/company/${companyId}/upgrade`;

  if (emails.length > 0) {
    await sendEmail({
      to: emails,
      subject: `ContaFlow: tu plan de ${companyName} vence en ${daysLeft} día${daysLeft !== 1 ? "s" : ""}`,
      html: buildReminderHtml(companyName, daysLeft, renewUrl),
    });
  }

  // WhatsApp: enchufable — no-op si no hay credenciales Meta. Requiere teléfono del cliente.
  if (telefono) {
    await sendWhatsAppTemplate({
      to: telefono.replace(/[^\d]/g, ""),
      templateName: "renovacion_recordatorio",
      languageCode: "es",
      bodyParams: [companyName, String(daysLeft)],
    });
  }
}

// Ejecuta el ciclo diario: marca vencidas como EXPIRED y envía recordatorios 7d/3d.
// Pensado para el cron /api/cron/billing-lifecycle (1×/día).
export async function runBillingLifecycle(now: Date = new Date()): Promise<BillingLifecycleResult> {
  const result: BillingLifecycleResult = {
    expiredMarked: 0,
    reminders7Sent: 0,
    reminders3Sent: 0,
    errors: [],
  };

  // 1. Marcar EXPIRED las suscripciones vivas cuyo período ya venció.
  try {
    const expired = await prisma.subscription.updateMany({
      where: {
        status: { in: ["ACTIVE", "PAST_DUE"] },
        currentPeriodEnd: { lt: now },
      },
      data: { status: "EXPIRED" },
    });
    result.expiredMarked = expired.count;
  } catch (err) {
    result.errors.push(`markExpired: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Recordatorios. Ventanas diarias para no duplicar (cron 1×/día).
  const windows: { days: number; key: "reminders7Sent" | "reminders3Sent" }[] = [
    { days: 7, key: "reminders7Sent" },
    { days: 3, key: "reminders3Sent" },
  ];

  for (const { days, key } of windows) {
    const from = new Date(now.getTime() + (days - 0.5) * MS_PER_DAY);
    const to = new Date(now.getTime() + (days + 0.5) * MS_PER_DAY);

    try {
      const subs = await prisma.subscription.findMany({
        where: {
          status: "ACTIVE",
          currentPeriodEnd: { gte: from, lt: to },
        },
        select: {
          companyId: true,
          company: {
            select: {
              name: true,
              telefono: true,
              members: {
                where: { role: "OWNER" },
                select: { user: { select: { email: true } } },
              },
            },
          },
        },
      });

      for (const sub of subs) {
        const emails = sub.company.members
          .map((m) => m.user?.email)
          .filter((e): e is string => Boolean(e));
        try {
          await notifyOwners(sub.companyId, sub.company.name, sub.company.telefono, emails, days);
          result[key] += 1;
        } catch (err) {
          result.errors.push(
            `reminder ${days}d ${sub.companyId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      result.errors.push(`query ${days}d: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
