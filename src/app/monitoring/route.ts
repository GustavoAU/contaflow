// src/app/monitoring/route.ts
// MEDIUM-2: Sentry tunnel con límite de body (1 MB) para evitar abuso.
// Proxea eventos al endpoint real de Sentry sin exponer el DSN al cliente.
import { NextRequest, NextResponse } from "next/server";

const BODY_LIMIT = 1 * 1024 * 1024; // 1 MB
const SENTRY_INGEST = "https://sentry.io";

export async function POST(request: NextRequest) {
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

  // Derivar URL de ingest desde el DSN
  let ingestUrl: string;
  try {
    const dsn = new URL(sentryDsn);
    const projectId = dsn.pathname.replace("/", "");
    ingestUrl = `${SENTRY_INGEST}/api/${projectId}/envelope/`;
  } catch {
    return NextResponse.json({ error: "Invalid DSN" }, { status: 400 });
  }

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
