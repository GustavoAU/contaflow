/**
 * BcvFetchService — Fase 14C
 *
 * Obtiene la tasa oficial USD/VES publicada por el BCV desde un endpoint
 * configurable (por defecto: ve.dolarapi.com/v1/dolares/oficial).
 *
 * La URL del endpoint se lee de la variable de entorno BCV_API_URL.
 * Si no está definida, se usa el valor por defecto de la comunidad venezolana.
 *
 * Nunca lanza errores no descriptivos — siempre envuelve la causa original.
 */

import { Decimal } from "decimal.js";
import { z } from "zod";

// ─── Respuesta esperada de la API ─────────────────────────────────────────────
const BcvApiResponseSchema = z.object({
  promedio: z.number().positive(),
  fecha_actualizacion: z.string(),
});

export type BcvFetchResult = {
  rate: Decimal;       // tasa USD/VES
  date: Date;          // fecha según la API (normalizada a 00:00:00 UTC)
  rawRate: number;     // valor numérico crudo para logging
};

// ─── URL por defecto ───────────────────────────────────────────────────────────
const DEFAULT_BCV_URL =
  "https://ve.dolarapi.com/v1/dolares/oficial";

// ─── Servicio ─────────────────────────────────────────────────────────────────
export class BcvFetchService {
  /**
   * Obtiene la tasa oficial USD/VES más reciente del BCV.
   *
   * Lanza un Error descriptivo si:
   * - El endpoint no responde en el timeout configurado
   * - La respuesta no es un JSON válido
   * - La respuesta no contiene los campos esperados (Zod)
   * - La tasa devuelta es 0 o negativa
   */
  static async fetchUsdVes(): Promise<BcvFetchResult> {
    const url = process.env.BCV_API_URL ?? DEFAULT_BCV_URL;

    let response: Response;
    try {
      response = await fetch(url, {
        // Next.js: no-store para siempre obtener el valor más reciente
        cache: "no-store",
        signal: AbortSignal.timeout(10_000), // 10 s
      });
    } catch (err) {
      throw new Error(
        `BcvFetchService: no se pudo contactar el endpoint BCV (${url}). ` +
          `Causa: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `BcvFetchService: el endpoint BCV respondió con HTTP ${response.status}. ` +
          `URL: ${url}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        `BcvFetchService: la respuesta del endpoint BCV no es JSON válido. URL: ${url}`,
      );
    }

    const parsed = BcvApiResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? "schema inválido";
      throw new Error(
        `BcvFetchService: respuesta inesperada del endpoint BCV — ${issue}. URL: ${url}`,
      );
    }

    const { promedio, fecha_actualizacion } = parsed.data;

    // Normalizar fecha a 00:00:00 UTC para que coincida con la clave
    // @@unique([companyId, currency, date]) en ExchangeRate
    const rawDate = new Date(fecha_actualizacion);
    const normalizedDate = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()),
    );

    return {
      rate: new Decimal(promedio.toString()),
      date: normalizedDate,
      rawRate: promedio,
    };
  }
}
