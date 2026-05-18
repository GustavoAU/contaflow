// src/app/monitoring/route.ts
// Sentry tunnel: proxies events to Sentry without exposing DSN to the client.
// HIGH-2: DSN pinned against NEXT_PUBLIC_SENTRY_DSN — rejects requests targeting
// any other project (prevents open relay abuse). IP rate-limited at 100 req/min.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

const BODY_LIMIT = 1 * 1024 * 1024; // 1 MB
const SENTRY_INGEST = "https://sentry.io";

// Extract the expected project ID from the env DSN at cold-start so we don't
// re-parse on every request. Null means no env var is set (allow-all in dev).
const EXPECTED_PROJECT_ID: string | null = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    return new URL(dsn).pathname.replace("/", "");
  } catch {
    return null;
  }
})();

export async function POST(request: NextRequest) {
  // Rate limit by IP — unauthenticated endpoint
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rl = await checkRateLimit(`sentry:${ip}`, limiters.sentry);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > BODY_LIMIT) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > BODY_LIMIT) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // El primer campo del envelope de Sentry contiene el DSN en JSON
  const envelopeHeader = rawBody.split("\n")[0];
  let sentryDsn: string | undefined;
  try {
    const header = JSON.parse(envelopeHeader) as { dsn?: string };
    sentryDsn = header.dsn;
  } catch {
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }

  if (!sentryDsn) {
    return NextResponse.json({ error: "Missing DSN" }, { status: 400 });
  }

  // Pin DSN — only allow requests targeting our own Sentry project
  let projectId: string;
  try {
    projectId = new URL(sentryDsn).pathname.replace("/", "");
  } catch {
    return NextResponse.json({ error: "Invalid DSN" }, { status: 400 });
  }

  if (EXPECTED_PROJECT_ID !== null && projectId !== EXPECTED_PROJECT_ID) {
    return NextResponse.json({ error: "Unauthorized DSN" }, { status: 403 });
  }

  const ingestUrl = `${SENTRY_INGEST}/api/${projectId}/envelope/`;

  try {
    const upstream = await fetch(ingestUrl, {
      method: "POST",
      body: rawBody,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });
    return new NextResponse(null, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: "Upstream unreachable" }, { status: 502 });
  }
}
