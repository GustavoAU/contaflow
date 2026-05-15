// src/app/api/webhooks/nowpayments/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyNowPaymentsSignature, type NowPaymentsIPN } from "@/lib/nowpayments";
import * as BillingService from "@/modules/billing/services/BillingService";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-nowpayments-sig") ?? "";
  const secret = process.env.NOWPAYMENTS_IPN_SECRET_KEY ?? "";

  if (!secret) {
    console.error("[nowpayments-webhook] NOWPAYMENTS_IPN_SECRET_KEY no configurado");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Verificar firma antes de procesar cualquier dato
  if (!verifyNowPaymentsSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let ipn: NowPaymentsIPN;
  try {
    ipn = JSON.parse(rawBody) as NowPaymentsIPN;
  } catch {
    // JSON inválido → 200 para que NOWPayments no reintente datos corruptos
    return NextResponse.json({ ignored: true });
  }

  const ipnSourceIp =
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");

  try {
    await BillingService.handleIPN(ipn, ipnSourceIp);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // LOW-2: capturar en Sentry para observabilidad; nunca exponer IDs internos en la respuesta HTTP
    Sentry.captureException(error, {
      tags: { webhook: "nowpayments" },
      extra: { payment_id: ipn.payment_id, payment_status: ipn.payment_status },
    });

    // Pago no encontrado → 200 (evita reintentos infinitos de NOWPayments)
    if (message === "Pago no encontrado") {
      return NextResponse.json({ ignored: true });
    }

    // Error transitorio → 500 para que NOWPayments reintente
    return NextResponse.json({ error: "Error interno procesando pago" }, { status: 500 });
  }
}
