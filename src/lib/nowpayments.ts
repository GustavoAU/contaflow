// src/lib/nowpayments.ts
import crypto from "crypto";

const SANDBOX_URL = "https://api-sandbox.nowpayments.io/v1";
const PROD_URL = "https://api.nowpayments.io/v1";

function getBaseUrl(): string {
  return process.env.NOWPAYMENTS_SANDBOX === "true" ? SANDBOX_URL : PROD_URL;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type NowPaymentsStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export interface NowPaymentsInvoice {
  id: string;
  token_id: string;
  order_id: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string | null;
  ipn_callback_url: string;
  invoice_url: string;
  success_url?: string;
  cancel_url?: string;
}

export interface NowPaymentsIPN {
  payment_id: string | number;
  payment_status: NowPaymentsStatus;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  actually_paid: number;
  order_id: string;
  order_description?: string;
  outcome_amount?: number;
  outcome_currency?: string;
}

export interface CreateInvoiceParams {
  priceAmountCents: number;
  payCurrency?: string;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
  successUrl?: string;
  cancelUrl?: string;
}

// ─── Crear invoice ────────────────────────────────────────────────────────────

export async function createNowPaymentsInvoice(
  params: CreateInvoiceParams,
): Promise<NowPaymentsInvoice> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY no configurado");

  const response = await fetch(`${getBaseUrl()}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: params.priceAmountCents / 100,
      price_currency: "usd",
      pay_currency: params.payCurrency ?? "usdterc20",
      ipn_callback_url: params.ipnCallbackUrl,
      order_id: params.orderId,
      order_description: params.orderDescription,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NOWPayments API ${response.status}: ${body}`);
  }

  return response.json() as Promise<NowPaymentsInvoice>;
}

// ─── Verificar firma IPN ──────────────────────────────────────────────────────

export function verifyNowPaymentsSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return false;
  }

  const sorted = Object.keys(parsed)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = parsed[key];
      return acc;
    }, {});

  const expected = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sorted))
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const signatureBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}
