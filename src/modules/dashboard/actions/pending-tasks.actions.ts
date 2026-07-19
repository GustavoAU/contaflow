"use server";
// src/modules/dashboard/actions/pending-tasks.actions.ts
//
// Security resolved:
//   26B-01 CRITICAL — IDOR: companyMember guard antes de cualquier query
//   26B-02 HIGH     — Prompt injection: solo se pasan counts al LLM, nunca texto libre
//   26B-03 HIGH     — Rate limit Gemini: limiters.ocr (10/min) en el path de IA
//   26B-05 MEDIUM   — Rol mínimo: ROLES.ACCOUNTING

import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { ROLES } from "@/lib/auth-helpers";
import { PendingTasksService, type PendingTasksData } from "../services/PendingTasksService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { code: number; message: string };
}

// Genera un resumen ejecutivo en español usando Gemini Flash.
// Solo recibe counts (sin texto libre del usuario — 26B-02).
async function generateAISummary(tasks: PendingTasksData["tasks"]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || tasks.length === 0) return null;

  // Solo pasamos tipos y counts — nunca texto libre ni datos del usuario (26B-02)
  const taskList = tasks
    .map((t) => `- ${t.type}: ${t.count} pendiente${t.count > 1 ? "s" : ""}`)
    .join("\n");

  const prompt = `Eres un contador venezolano experto. Resume en 2 oraciones (máximo 120 caracteres cada una) las siguientes tareas de compliance fiscal pendientes. Sé directo y accionable. No uses markdown. Solo devuelve el resumen en texto plano.

Tareas detectadas:
${taskList}

Responde ÚNICAMENTE con el resumen en español.`;

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text ?? null;
  } catch {
    return null; // graceful fallback
  }
}

// ─── Action pública ────────────────────────────────────────────────────────────

type DashboardTasksResult = ActionResult<PendingTasksData & { aiSummary: string | null }>;

export async function getPendingTasksAction(
  companyId: string,
): Promise<DashboardTasksResult> {
  try {
    // Auth (26B-01) + IDOR guard + Role guard (26B-05 MEDIUM, mínimo ACCOUNTING) +
    // rate limit base: lectura de tareas pendientes del dashboard — limiter de lecturas
    // (120/min por empresa×usuario), no el fiscal (10/min). El resumen IA (abajo) mantiene `ocr`.
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING, limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

    // Obtener tareas (queries determinísticas)
    const data = await PendingTasksService.getPendingTasks(companyId);

    // Resumen IA — rate limit OCR independiente (26B-03 HIGH)
    let aiSummary: string | null = null;
    if (data.tasks.length > 0) {
      const aiRl = await checkRateLimit(ctx.userId, limiters.ocr);
      if (aiRl.allowed) {
        aiSummary = await generateAISummary(data.tasks);
      }
    }

    return { success: true, data: { ...data, aiSummary } };
  } catch (err) {
    return toActionError(err);
  }
}
