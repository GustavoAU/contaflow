// src/modules/notifications/services/NotificationEmailService.ts
// Genera y envía el digest diario de tareas pendientes por empresa.
// Solo envía si hay tareas de severity "error" o "warning" (no "info" solo).
// Destinatarios: todos los CompanyMember con role OWNER o ADMIN que tengan email en Clerk.
// Ref: Q1-1 backlog

import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { PendingTasksService, type PendingTask } from "@/modules/dashboard/services/PendingTasksService";

export interface NotificationResult {
  companyId: string;
  companyName: string;
  taskCount: number;
  emailsSent: number;
  skipped: boolean;    // true si no hay tareas urgentes o no hay destinatarios
  errors: string[];
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function severityLabel(s: PendingTask["severity"]): string {
  if (s === "error") return "🔴 Crítico";
  if (s === "warning") return "🟡 Advertencia";
  return "🔵 Info";
}

function buildDigestHtml(
  companyName: string,
  tasks: PendingTask[],
  appUrl: string,
  companyId: string,
): string {
  const dashboardUrl = `${appUrl}/company/${companyId}`;
  const errors = tasks.filter((t) => t.severity === "error");
  const warnings = tasks.filter((t) => t.severity === "warning");

  const taskRows = tasks
    .map(
      (t) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
        ${severityLabel(t.severity)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
        <strong>${t.title}</strong><br>
        <span style="color:#6b7280;">${t.description}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:center;">
        <a href="${dashboardUrl}${t.href}" style="color:#2563eb;text-decoration:none;">Ver →</a>
      </td>
    </tr>`,
    )
    .join("");

  const summaryParts: string[] = [];
  if (errors.length > 0) summaryParts.push(`<strong style="color:#dc2626">${errors.length} crítico${errors.length !== 1 ? "s" : ""}</strong>`);
  if (warnings.length > 0) summaryParts.push(`<strong style="color:#d97706">${warnings.length} advertencia${warnings.length !== 1 ? "s" : ""}</strong>`);

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td>
      <table width="600" cellpadding="0" cellspacing="0" align="center" style="background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#1d4ed8;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;">ContaFlow</span>
            <span style="color:#93c5fd;font-size:13px;margin-left:8px;">Resumen diario de compliance</span>
          </td>
        </tr>

        <!-- Company + summary -->
        <tr>
          <td style="padding:24px 32px 16px;">
            <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#111827;">${companyName}</p>
            <p style="margin:0;font-size:14px;color:#6b7280;">
              Hoy tienes ${summaryParts.join(" y ")} que requieren atención.
            </p>
          </td>
        </tr>

        <!-- Tasks table -->
        <tr>
          <td style="padding:0 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Nivel</th>
                  <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Tarea</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Acción</th>
                </tr>
              </thead>
              <tbody>${taskRows}</tbody>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 32px 32px;text-align:center;">
            <a href="${dashboardUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;text-decoration:none;">
              Ir al dashboard →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              Este correo fue enviado automáticamente por ContaFlow.<br>
              Recibirás este resumen cada día que haya tareas pendientes urgentes.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Main Service ─────────────────────────────────────────────────────────────

export const NotificationEmailService = {
  /**
   * Envía el digest de tareas pendientes para todas las empresas con tareas urgentes.
   * Llama a Clerk Users API para obtener emails de OWNER/ADMIN.
   * Se ejecuta desde el cron /api/cron/daily-notifications.
   */
  async sendDailyDigests(): Promise<NotificationResult[]> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    // 1. Obtener todas las empresas activas (con al menos un miembro OWNER/ADMIN)
    // ADR-004-EXCEPTION: cron job cross-company — sendDailyDigests opera sobre TODAS las
    // empresas activas por diseño. No existe un companyId de contexto aquí porque el digest
    // se envía desde /api/cron/daily-notifications, que no está scoped a una empresa concreta.
    const companies = await prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        members: {
          where: { role: { in: ["OWNER", "ADMIN"] } },
          select: { userId: true },
        },
      },
    });

    const results: NotificationResult[] = [];

    for (const company of companies) {
      const result: NotificationResult = {
        companyId: company.id,
        companyName: company.name,
        taskCount: 0,
        emailsSent: 0,
        skipped: false,
        errors: [],
      };

      try {
        // 2. Obtener tareas pendientes
        const { tasks } = await PendingTasksService.getPendingTasks(company.id);
        const urgentTasks = tasks.filter((t) => t.severity === "error" || t.severity === "warning");

        if (urgentTasks.length === 0) {
          result.skipped = true;
          results.push(result);
          continue;
        }

        result.taskCount = urgentTasks.length;

        // 3. Obtener emails de admins vía Clerk API
        const adminEmails = await getAdminEmails(company.members.map((m) => m.userId));

        if (adminEmails.length === 0) {
          result.skipped = true;
          result.errors.push("Sin admins con email verificado");
          results.push(result);
          continue;
        }

        // 4. Enviar email (un email a todos los admins como BCC-style via to array)
        const html = buildDigestHtml(company.name, urgentTasks, appUrl, company.id);
        const emailResult = await sendEmail({
          to: adminEmails,
          subject: `ContaFlow: ${urgentTasks.length} tarea${urgentTasks.length !== 1 ? "s" : ""} pendiente${urgentTasks.length !== 1 ? "s" : ""} — ${company.name}`,
          html,
        });

        if (emailResult.ok) {
          result.emailsSent = adminEmails.length;
        } else {
          result.errors.push(emailResult.error ?? "Error desconocido");
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }

      results.push(result);
    }

    return results;
  },

  /**
   * Envía el digest solo para una empresa específica (uso desde UI o testing).
   */
  async sendDigestForCompany(companyId: string): Promise<NotificationResult> {
    const results = await this.sendDailyDigests();
    return (
      results.find((r) => r.companyId === companyId) ?? {
        companyId,
        companyName: "Desconocida",
        taskCount: 0,
        emailsSent: 0,
        skipped: true,
        errors: ["No encontrada en el batch"],
      }
    );
  },
};

// ─── Clerk Users API ──────────────────────────────────────────────────────────

async function getAdminEmails(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (!clerkSecret) {
    console.warn("[NotificationEmailService] CLERK_SECRET_KEY no configurado — no se pueden obtener emails");
    return [];
  }

  const emails: string[] = [];

  // Clerk API: GET /v1/users/:id — llamadas en paralelo (máx 5 a la vez)
  const chunks = chunk(userIds, 5);
  for (const batch of chunks) {
    const results = await Promise.allSettled(
      batch.map(async (userId) => {
        const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
        if (!res.ok) return null;
        const user = await res.json() as { email_addresses?: Array<{ email_address: string; verification?: { status: string } }> };
        const primary = user.email_addresses?.find((e) => e.verification?.status === "verified");
        return primary?.email_address ?? null;
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) emails.push(r.value);
    }
  }

  return emails;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
