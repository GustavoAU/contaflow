"use server";
// src/modules/ai-assistant/actions/ai-assistant.actions.ts
//
// Security:
//   26-01 CRITICAL — IDOR: companyMember guard antes de cualquier query
//   26-02 HIGH     — Prompt injection: pregunta del usuario va SEPARADA del contexto estructurado
//   26-03 HIGH     — Rate limit Gemini: limiters.ocr (10/min)
//   26-04 MEDIUM   — Imagen: se envía base64 a Gemini Vision (sandbox Google) — no se ejecuta
//   26-05 MEDIUM   — Rol mínimo: ROLES.ACCOUNTING

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { AIContextBuilderService } from "../services/AIContextBuilderService";
import { FiscalAnomalyDetectorService } from "../services/FiscalAnomalyDetectorService";

const GEMINI_TEXT_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent";
const GEMINI_VISION_URL =
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
  const url = `${imageBase64 ? GEMINI_VISION_URL : GEMINI_TEXT_URL}?key=${apiKey}`;

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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: userParts }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
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

// ─── Action pública ────────────────────────────────────────────────────────────

export async function sendMessageAction(
  companyId: string,
  userMessage: string,
  imageBase64?: string,
): Promise<SendMessageResult> {
  // Auth (26-01)
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autenticado" };

  // IDOR guard (26-01 CRITICAL)
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Sin acceso" };

  // Role guard (26-05 MEDIUM)
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Rol insuficiente" };
  }

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
    // Fallback sin IA: modo auditoría devuelve reporte de anomalías, resto devuelve aviso
    if (isAuditMode && anomalyReport) {
      return {
        success: true,
        reply: FiscalAnomalyDetectorService.formatForPrompt(anomalyReport),
        isAuditMode: true,
      };
    }
    if (isAuditMode) {
      return {
        success: true,
        reply: buildAuditFallbackMessage(ctx.pendingTasks),
        isAuditMode: true,
      };
    }
    return {
      success: true,
      reply: "El asistente IA no está configurado. Contacta al administrador.",
      isAuditMode: false,
    };
  }

  // Llamar a Gemini
  const reply = await callGemini(apiKey, systemPrompt, userMessage, imageBase64);

  if (!reply) {
    // Graceful fallback
    if (isAuditMode && anomalyReport) {
      return {
        success: true,
        reply: FiscalAnomalyDetectorService.formatForPrompt(anomalyReport),
        isAuditMode: true,
      };
    }
    if (isAuditMode) {
      return {
        success: true,
        reply: buildAuditFallbackMessage(ctx.pendingTasks),
        isAuditMode: true,
      };
    }
    return {
      success: true,
      reply: "No pude obtener respuesta del asistente en este momento. Intenta de nuevo.",
      isAuditMode: false,
    };
  }

  return { success: true, reply, isAuditMode };
}
