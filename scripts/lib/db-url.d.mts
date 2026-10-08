export interface ResolveDatabaseUrlOptions {
  /** Entorno a consultar. Por defecto `process.env`. `CI` se deduce de aquí. */
  env?: Record<string, string | undefined>;
  /**
   * Devuelve el contenido de `.env.local` o `null` si no existe. Por defecto lee
   * `<raíz del repo>/.env.local`. Nunca se invoca en CI.
   */
  readEnvLocal?: () => string | null;
}
export function resolveDatabaseUrl(opts?: ResolveDatabaseUrlOptions): string;
