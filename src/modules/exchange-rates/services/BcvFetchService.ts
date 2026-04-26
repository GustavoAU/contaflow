/**
 * BcvFetchService — Fase 14C
 *
 * USD/VES: ve.dolarapi.com/v1/dolares/oficial
 * EUR/VES: ve.dolarapi.com/v1/euros/oficial
 * Ambos endpoints comparten el mismo schema de respuesta (promedio + fechaActualizacion).
 *
 * URLs configurables vía env: BCV_API_URL (USD) y BCV_EUR_API_URL (EUR).
 */

import { Decimal } from "decimal.js";
import { z } from "zod";

const BcvApiResponseSchema = z.object({
  promedio: z.number().positive(),
  fechaActualizacion: z.string(),
});

export type BcvFetchResult = {
  rate: Decimal;
  date: Date;
  rawRate: number;
};

const DEFAULT_USD_URL = "https://ve.dolarapi.com/v1/dolares/oficial";
const DEFAULT_EUR_URL = "https://ve.dolarapi.com/v1/euros/oficial";

export class BcvFetchService {
  static async fetchUsdVes(): Promise<BcvFetchResult> {
    return BcvFetchService.fetchFromUrl(
      process.env.BCV_API_URL ?? DEFAULT_USD_URL,
      "BCV USD",
    );
  }

  static async fetchEurVes(): Promise<BcvFetchResult> {
    return BcvFetchService.fetchFromUrl(
      process.env.BCV_EUR_API_URL ?? DEFAULT_EUR_URL,
      "BCV EUR",
    );
  }

  private static async fetchFromUrl(url: string, label: string): Promise<BcvFetchResult> {
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(
        `BcvFetchService: no se pudo contactar el endpoint ${label} (${url}). ` +
          `Causa: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `BcvFetchService: el endpoint ${label} respondió con HTTP ${response.status}. URL: ${url}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        `BcvFetchService: la respuesta del endpoint ${label} no es JSON válido. URL: ${url}`,
      );
    }

    const parsed = BcvApiResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? "schema inválido";
      throw new Error(
        `BcvFetchService: respuesta inesperada del endpoint ${label} — ${issue}. URL: ${url}`,
      );
    }

    const { promedio, fechaActualizacion } = parsed.data;
    const rawDate = new Date(fechaActualizacion);
    const date = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()),
    );

    return {
      rate: new Decimal(promedio.toString()),
      date,
      rawRate: promedio,
    };
  }
}
