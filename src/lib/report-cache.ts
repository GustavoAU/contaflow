// src/lib/report-cache.ts
// Cache en memoria para reportes de períodos CERRADOS.
// Solo períodos CLOSED se cachean — son inmutables una vez cerrados (ADR-005).
// YAGNI: Map en memoria, sin Redis ni persistencia para esta fase.
// En Vercel, cada instancia tiene su propio cache — aceptable (TTL de 5 min).

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // Date.now() + TTL
}

// ─── Constantes ───────────────────────────────────────────────────────────────

// TTL de 5 minutos para períodos cerrados (inmutables — bajo riesgo de stale)
export const CLOSED_PERIOD_TTL_MS = 5 * 60 * 1000;

// ─── Store ────────────────────────────────────────────────────────────────────

// Se limpia al reiniciar el proceso — comportamiento esperado y correcto.
// No exportar directamente para forzar uso de las funciones de acceso.
const cache = new Map<string, CacheEntry<unknown>>();

// ─── Funciones públicas ───────────────────────────────────────────────────────

/**
 * Genera una cache key consistente para un reporte.
 * Formato: `{companyId}:{periodId}:{reportType}`
 */
export function makeCacheKey(
  companyId: string,
  periodId: string,
  reportType: string
): string {
  return `${companyId}:${periodId}:${reportType}`;
}

/**
 * Obtiene el dato del cache si existe y no expiró.
 * Retorna null si no existe o si la entrada expiró (lazy expiry).
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Guarda un dato en el cache con TTL.
 * @param key    - cache key (usar makeCacheKey)
 * @param data   - dato a cachear
 * @param ttlMs  - TTL en ms (default: CLOSED_PERIOD_TTL_MS = 5 min)
 */
export function setCached<T>(
  key: string,
  data: T,
  ttlMs: number = CLOSED_PERIOD_TTL_MS
): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Invalida (elimina) todas las entradas de cache para un período específico.
 * Llamar desde PeriodService.reopenPeriod o cuando el período se reabre.
 * Elimina todas las keys con prefijo `{companyId}:{periodId}:`.
 */
export function invalidatePeriod(companyId: string, periodId: string): void {
  const prefix = `${companyId}:${periodId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Wrapper que aplica cache automáticamente según el estado del período:
 * - Si período CLOSED → busca en cache; si miss → ejecuta fn y cachea el resultado
 * - Si período OPEN  → ejecuta fn directamente sin cachear (datos en tiempo real)
 *
 * Solo lectura — nunca usar en operaciones de escritura.
 *
 * @param companyId    - empresa (ADR-004)
 * @param periodId     - id del período contable
 * @param periodStatus - 'OPEN' | 'CLOSED' (del modelo AccountingPeriod.status)
 * @param reportType   - identificador del tipo de reporte (ej. 'transactions', 'balance')
 * @param fn           - función que calcula el reporte
 */
export async function withPeriodCache<T>(
  companyId: string,
  periodId: string,
  periodStatus: string,
  reportType: string,
  fn: () => Promise<T>
): Promise<T> {
  // Períodos OPEN: calcular siempre en tiempo real — datos pueden cambiar
  if (periodStatus !== "CLOSED") {
    return fn();
  }

  // Períodos CLOSED: inmutables — usar cache
  const key = makeCacheKey(companyId, periodId, reportType);
  const cached = getCached<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Cache miss — calcular y guardar
  const result = await fn();
  setCached(key, result);
  return result;
}
