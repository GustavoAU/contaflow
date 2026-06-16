// src/modules/billing/services/SubscriptionService.ts
// Ciclo de vida de la suscripción: estado (activa/vencida), recordatorios de
// renovación (7d/3d antes, email + WhatsApp) y marcado de EXPIRED.
//
// Modelo de cobro: pago manual en USDT (NOWPayments). NO hay débito automático.
// El corte por expiración es "solo lectura": ver isWriteAllowed (usado por el guard).
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

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

// ─── Cron lifecycle ─────────────────────────────────────────────────────────

export interface BillingLifecycleResult {
  expiredMarked: number;
  reminders7Sent: number;
  reminders3Sent: number;
  errors: string[];
}

function buildReminderHtml(companyName: string, daysLeft: number, renewUrl: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#3b3bdb">Tu suscripción de ContaFlow vence en ${daysLeft} día${daysLeft !== 1 ? "s" : ""}</h2>
      <p>Hola, la suscripción de <strong>${companyName}</strong> está por vencer.</p>
      <p>Para no perder acceso a la creación de facturas, retenciones y demás operaciones,
      renueva tu plan antes del vencimiento. Tus datos y reportes siempre estarán disponibles.</p>
      <p style="margin:24px 0">
        <a href="${renewUrl}" style="background:#3b3bdb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Renovar mi plan
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">El pago se procesa en USDT vía NOWPayments. Si ya renovaste, ignora este mensaje.</p>
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
