"use server";
// src/modules/ai-assistant/actions/ai-assistant.actions.ts
//
// Security:
//   26-01 CRITICAL — IDOR: companyMember guard antes de cualquier query
//   26-02 HIGH     — Prompt injection: pregunta del usuario va SEPARADA del contexto estructurado
//   26-03 HIGH     — Rate limit Gemini: limiters.ocr (10/min)
//   26-04 MEDIUM   — Imagen: se envía base64 a Gemini Vision (sandbox Google) — no se ejecuta
//   26-05 MEDIUM   — Rol mínimo: ROLES.ACCOUNTING

import { ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { AIContextBuilderService } from "../services/AIContextBuilderService";
import { FiscalAnomalyDetectorService } from "../services/FiscalAnomalyDetectorService";
import type { FiscalAnomalyReport } from "../services/FiscalAnomalyDetectorService";

// Texto y visión usan el mismo modelo — una sola constante evita divergencias silenciosas.
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { code: number; message: string };
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SendMessageResult =
  | { success: true; reply: string; isAuditMode: boolean }
  | { success: false; error: string };

// ─── Helpers Gemini ───────────────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  imageBase64?: string,
): Promise<string | null> {
  // El sistema y la pregunta van en partes SEPARADAS — (26-02)
  const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: userMessage },
  ];

  if (imageBase64) {
    // Detectar mime type básico desde el header base64
    const mime = imageBase64.startsWith("/9j/") ? "image/jpeg" : "image/png";
    userParts.push({ inlineData: { mimeType: mime, data: imageBase64 } });
  }

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Guard de acceso al módulo AI ────────────────────────────────────────────
// Verifica autenticación, membresía a la empresa y rol mínimo (ACCOUNTING).
// Retorna { userId } si el acceso está permitido, o { success: false, error } si no.
type AIGuardResult = { userId: string } | { success: false; error: string };

async function guardAIAccess(companyId: string): Promise<AIGuardResult> {
  // IDOR guard (26-01 CRITICAL) + Role guard (26-05 MEDIUM): mínimo rol Contador
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;
  return { userId: ctx.userId };
}

// ─── Modo auditoría — fallback con PendingTasksService ────────────────────────

function buildAuditFallbackMessage(
  pendingTasks: { type: string; severity: string; count: number }[],
): string {
  if (pendingTasks.length === 0) {
    return "No se detectaron tareas pendientes de compliance. El período parece estar al día.";
  }
  const lines = pendingTasks.map(
    (t) => `• [${t.severity.toUpperCase()}] ${t.type}: ${t.count} pendiente${t.count > 1 ? "s" : ""}`,
  );
  return `Auditoría de tareas pendientes (modo básico):\n\n${lines.join("\n")}\n\n⚠️ El módulo de auditoría avanzada (FiscalAnomalyDetectorService) se habilitará en la próxima actualización.`;
}

// Construye la respuesta de modo auditoría sin necesitar a Gemini.
// Si hay un reporte de anomalías usa ese; de lo contrario usa el fallback de tareas pendientes.
function buildAuditModeReply(
  anomalyReport: FiscalAnomalyReport | null,
  pendingTasks: { type: string; severity: string; count: number }[],
): SendMessageResult {
  const reply = anomalyReport
    ? FiscalAnomalyDetectorService.formatForPrompt(anomalyReport)
    : buildAuditFallbackMessage(pendingTasks);
  return { success: true, reply, isAuditMode: true };
}

// ─── Action pública ────────────────────────────────────────────────────────────

export async function sendMessageAction(
  companyId: string,
  userMessage: string,
  imageBase64?: string,
): Promise<SendMessageResult> {
  try {
  // Auth + IDOR + Role (26-01 CRITICAL / 26-05 MEDIUM)
  const guard = await guardAIAccess(companyId);
  if ("error" in guard) return guard;
  const { userId } = guard;

  // Rate limit (26-03 HIGH)
  const rl = await checkRateLimit(userId, limiters.ocr);
  if (!rl.allowed) {
    return { success: false, error: "Límite de consultas alcanzado. Intenta en un momento." };
  }

  // Detectar modo auditoría
  const isAuditMode = /audit|auditar|auditor[ií]a|errores.*(período|mes|contab)/i.test(userMessage);

  // Construir contexto financiero (y anomalías en paralelo si modo auditoría)
  const [ctx, anomalyReport] = await Promise.all([
    AIContextBuilderService.buildContext(companyId),
    isAuditMode ? FiscalAnomalyDetectorService.detect(companyId) : Promise.resolve(null),
  ]);

  // Prompt base + sección de auditoría inyectada si corresponde
  const basePrompt = AIContextBuilderService.buildSystemPrompt(ctx);
  const systemPrompt = anomalyReport
    ? `${basePrompt}\n\n═══════════════════════════════════════════════\n${FiscalAnomalyDetectorService.formatForPrompt(anomalyReport)}\n═══════════════════════════════════════════════`
    : basePrompt;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Fallback sin IA: modo auditoría devuelve reporte local, resto devuelve aviso al usuario
    if (isAuditMode) return buildAuditModeReply(anomalyReport, ctx.pendingTasks);
    return { success: true, reply: "El asistente IA no está configurado. Contacta al administrador.", isAuditMode: false };
  }

  // Llamar a Gemini
  const reply = await callGemini(apiKey, systemPrompt, userMessage, imageBase64);

  if (!reply) {
    // Graceful fallback cuando Gemini no responde
    if (isAuditMode) return buildAuditModeReply(anomalyReport, ctx.pendingTasks);
    return { success: true, reply: "No pude obtener respuesta del asistente en este momento. Intenta de nuevo.", isAuditMode: false };
  }

  return { success: true, reply, isAuditMode };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado en el asistente" };
  }
}

// ─── Resumen de anomalías (para badge del botón flotante) ─────────────────────
// No llama a Gemini — solo ejecuta el detector y retorna los contadores.
// Sin rate limit porque es solo lectura y barata en tiempo.

export type AnomalySummaryResult =
  | { success: true; critical: number; high: number; medium: number }
  | { success: false; error: string };

export async function getAnomalySummaryAction(companyId: string): Promise<AnomalySummaryResult> {
  try {
    // Auth + IDOR + Role (26-01 CRITICAL / 26-05 MEDIUM)
    const guard = await guardAIAccess(companyId);
    if ("error" in guard) return guard;

    const report = await FiscalAnomalyDetectorService.detect(companyId);
    return {
      success: true,
      critical: report.totalCritical,
      high: report.totalHigh,
      medium: report.totalMedium,
    };
  } catch {
    // Si el detector o la DB fallan, no bloquear la UI — mostrar cero anomalías
    return { success: true, critical: 0, high: 0, medium: 0 };
  }
}
