// src/app/api/company/[companyId]/anomaly-summary/route.ts
// Resumen de anomalías para el badge del FloatingAIAssistant.
// Consumido por fetch() lazy desde el cliente — NO es Server Action, a propósito: así no
// pasa por la cola de acciones de Next (useActionQueue/useOptimistic), que con dispatch en
// el montaje disparaba "Rendered more hooks" (ver fix dashboard empresa 2026-06-13).
// Auth + IDOR + rol los aplica getAnomalySummaryAction (guardAIAccess); aquí añadimos
// rate limit de lectura (limiters.read, 120/min) — es una lectura, no una mutación.

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, limiters, fiscalKey } from "@/lib/ratelimit";
import { getAnomalySummaryAction } from "@/modules/ai-assistant/actions/ai-assistant.actions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  const { companyId } = await params;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
  }

  const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.read);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: rl.error }, { status: 429 });
  }

  // getAnomalySummaryAction: auth + IDOR (companyMember) + rol (ROLES.ACCOUNTING),
  // y degrada graceful (retorna ceros) si el detector o la DB fallan.
  const result = await getAnomalySummaryAction(companyId);
  return NextResponse.json(result);
}
