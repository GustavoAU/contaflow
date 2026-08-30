// src/modules/payroll/services/PayrollAutoDraftService.ts
//
// Borrador automático de nómina: el 1 y el 16 deja el proceso YA CALCULADO
// esperando revisión humana.
//
// Regla que gobierna todo el diseño: **se automatiza hasta dejarla lista; la
// APROBACIÓN la pulsa siempre una persona.** Aprobar genera el asiento contable
// y no se revierte, así que este servicio ni siquiera importa `approve`. Que la
// imposibilidad sea estructural, no una promesa.
//
// Se dibuja el período que acaba de TERMINAR, no el que empieza:
//   - día 16 → borrador del 1 al 15 del mes en curso
//   - día 1  → del 16 al fin del mes anterior (quincenal) o el mes anterior
//              completo (mensual)
// Es la única lectura coherente con que `approve()` feche el asiento en
// `periodEnd` y con que las horas extra se registren DESPUÉS de trabajarse.
// Dibujar el período entrante sería pagar trabajo no realizado y, por
// definición, con cero horas extra.

import prisma from "@/lib/prisma";
import { PayrollRunService } from "./PayrollRunService";
import { todayForCountry } from "@/lib/today-server";
import * as Sentry from "@sentry/nextjs";
import { MIXED_SALARY_MESSAGE } from "./payroll-currency";
import { READ_ONLY_MESSAGE } from "@/lib/prisma-billing-gate";
import type { PayrollFrequency } from "@prisma/client";
import { AUTO_DRAFT_ACTOR, AUTO_DRAFT_USER_AGENT } from "../utils/auto-draft";

// Re-export: la fuente única está en utils/, que la UI puede importar sin
// arrastrar `prisma` al bundle del cliente.
export { AUTO_DRAFT_ACTOR, AUTO_DRAFT_USER_AGENT } from "../utils/auto-draft";

/** Tope de empresas por invocación. `maxDuration` de Vercel es 60 s y `create`
 *  hace del orden de 15 consultas más el cálculo sobre Neon por WebSocket. El
 *  orden es estable por `companyId`. OJO: eso significa que las empresas que
 *  ordenen después del tope no se procesan NUNCA, no que roten. Con el volumen
 *  actual no se alcanza, pero la respuesta marca `truncated` para que no sea
 *  silencioso.
 *
 *  PENDIENTE: no existe todavía una alerta de dashboard que avise de que FALTA
 *  el proceso del período. Sin ella, un cron caído o truncado no produce señal
 *  visible para el usuario (sí para Sentry). No se afirma aquí que exista. */
export const MAX_COMPANIES_PER_RUN = 25;

export type AutoDraftStatus = "CREADA" | "OMITIDA" | "FALLIDA";

export interface AutoDraftResult {
  companyId: string;
  companyName: string;
  status: AutoDraftStatus;
  motivo?: string;
  runId?: string;
  periodStart?: string;
  periodEnd?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Período que acaba de terminar en `todayISO`, o `null` si esa fecha no es un
 * corte para la frecuencia dada.
 *
 * SEMANAL devuelve siempre `null`: no hay ancla del ciclo en la configuración
 * —ni día de pago ni primera semana—, así que habría que adivinar los límites, y
 * adivinar mal produce procesos solapados que envenenan la ranura del período.
 */
export function periodoCerradoEn(
  todayISO: string,
  frequency: PayrollFrequency,
): { start: string; end: string } | null {
  const [y, m, d] = todayISO.split("-").map(Number);

  if (frequency === "SEMANAL") return null;

  if (d === 16) {
    // Sólo quincenal cierra período el día 16. En mensual el 16 no es corte.
    if (frequency !== "BIWEEKLY") return null;
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15` };
  }

  if (d === 1) {
    // Mes anterior. En enero retrocede el año.
    const mesAnterior = m === 1 ? 12 : m - 1;
    const anio = m === 1 ? y - 1 : y;
    const ultimo = new Date(Date.UTC(anio, mesAnterior, 0)).getUTCDate();
    return frequency === "MONTHLY"
      ? { start: `${anio}-${pad(mesAnterior)}-01`, end: `${anio}-${pad(mesAnterior)}-${pad(ultimo)}` }
      : { start: `${anio}-${pad(mesAnterior)}-16`, end: `${anio}-${pad(mesAnterior)}-${pad(ultimo)}` };
  }

  return null;
}

/** Clave determinista: un reintento del cron no puede crear un segundo borrador.
 *
 *  Propiedad que NO se deduce mirando el código y hay que conservar:
 *  `@@unique([companyId, idempotencyKey])` es INCONDICIONAL —no excluye los
 *  CANCELLED—, así que si un humano cancela el borrador automático o pulsa
 *  Recalcular, la ranura del período se libera pero esta clave queda quemada.
 *  El cron NUNCA resucita un borrador que una persona descartó. Es deseado. */
export function autoDraftKey(start: string, end: string): string {
  return `auto:v1:${start}:${end}`;
}

/** Traduce a un motivo legible lo que `create` lanza. Casi todos los "fallos"
 *  son operación normal, no excepciones: período cerrado, sin tasa BCV, monedas
 *  mixtas, la ranura ya ocupada por el proceso de un humano, o la suscripción
 *  vencida (el gate de billing bloquea la escritura, y eso es correcto).
 *
 *  Se comparan las CONSTANTES reales, no literales copiados a mano: un literal
 *  copiado deja de casar en cuanto alguien reescribe el mensaje, y esa
 *  reescritura no la ve ni tsc ni ningún test. Donde el mensaje se construye al
 *  vuelo se busca un fragmento estable, y ese caso queda anotado como deuda:
 *  lo correcto a futuro es que `PayrollRunService` lance códigos tipados.
 *
 *  El `motivo` de FALLIDA NUNCA lleva el mensaje crudo: los errores del
 *  calculador y del guard de solape incluyen el NOMBRE del trabajador, y de aquí
 *  sale al cuerpo de la respuesta del cron y a los logs de invocación de Vercel
 *  — audiencia mucho más amplia que la de la base de datos. El detalle va a
 *  Sentry, que es donde se mira un fallo. */
function clasificar(mensaje: string): { status: AutoDraftStatus; motivo: string } {
  const m = mensaje.toLowerCase();
  const omitida = (motivo: string) => ({ status: "OMITIDA" as const, motivo });

  if (m.includes("ya se envió") || m.includes("idempotencykey")) {
    return omitida("Ya existe el borrador de este período (reintento del cron).");
  }
  if (mensaje.includes(MIXED_SALARY_MESSAGE) || m.includes("monedas mixtas")) {
    return omitida(
      "Hay sueldos que no se pueden procesar juntos (dos monedas, o un sueldo " +
      "en modalidad MIXTA). Requiere procesarse a mano."
    );
  }
  if (mensaje.includes(READ_ONLY_MESSAGE) || m.includes("solo lectura")) {
    return omitida("La suscripción está vencida: la empresa está en modo solo lectura.");
  }
  // "ya EXISTE un proceso" = la ranura período+moneda está ocupada.
  // "ya ESTÁ en un proceso" = un trabajador choca con otro período solapado, y
  // ese mensaje lleva su nombre. Son dos guards distintos; cubrir sólo el
  // primero mandaba el segundo a FALLIDA, con el nombre dentro.
  if (m.includes("ya existe un proceso") || m.includes("ya está en un proceso")) {
    return omitida("Ya hay un proceso vigente que cubre estas fechas: se respeta el del usuario.");
  }
  if (m.includes("período contable")) {
    return omitida("El período contable de esas fechas está cerrado.");
  }
  if (m.includes("tasa bcv") || m.includes("tasa de cambio")) {
    return omitida("Falta la tasa BCV para convertir los topes legales.");
  }
  if (m.includes("no hay empleados") || m.includes("vigencia al inicio")) {
    return omitida("Nadie con sueldo vigente al inicio del período.");
  }
  if (m.includes("configure la nómina")) {
    return omitida("La nómina no está configurada.");
  }
  return {
    status: "FALLIDA",
    motivo: "Error inesperado al calcular. El detalle está en Sentry.",
  };
}

export const PayrollAutoDraftService = {
  periodoCerradoEn,
  autoDraftKey,

  /**
   * Recorre las empresas con el borrador automático activo y deja el proceso
   * calculado. Ninguna excepción sale del bucle: una empresa que falla no puede
   * tumbar el lote.
   */
  async runAutoDrafts(nowISO?: string): Promise<{ results: AutoDraftResult[]; total: number; truncated: boolean }> {
    // "Hoy" se resuelve DENTRO del bucle, en la zona de cada empresa (ADR-042):
    // `vercel.json` programa en UTC, y una hora de madrugada UTC caería en el día
    // ANTERIOR en Venezuela — el 31 en vez del 1, o sea el mes equivocado.

    // Única lectura cross-tenant del servicio, deliberada, con precedente en
    // runBillingLifecycle y sendDailyDigests. Todo lo demás va por companyId.
    const configs = await prisma.payrollConfig.findMany({
      where: { autoDraftEnabled: true },
      select: {
        companyId: true,
        frequency: true,
        // `country` para resolver "hoy" en la zona de CADA empresa, no en VEN
        // fijo. `scopeProfile` porque el perfil SOLO no tiene módulo de Nómina:
        // hoy eso sólo lo bloquea la navegación, así que sin este filtro el cron
        // le seguiría creando procesos a una empresa que ni siquiera ve el
        // módulo — y sin pantalla desde donde apagarlo.
        company: { select: { name: true, country: true, scopeProfile: true } },
      },
      orderBy: { companyId: "asc" }, // orden estable: el tope corta siempre igual
      take: MAX_COMPANIES_PER_RUN,
    });

    // Cuántas habría en total: sin esto, el corte del `take` es invisible y una
    // empresa que ordene después del tope queda apagada sin que nadie lo sepa.
    const total = await prisma.payrollConfig.count({ where: { autoDraftEnabled: true } });

    const resultados: AutoDraftResult[] = [];

    for (const cfg of configs) {
      const nombre = cfg.company.name;

      if (cfg.company.scopeProfile === "SOLO") {
        resultados.push({
          companyId: cfg.companyId,
          companyName: nombre,
          status: "OMITIDA",
          motivo: "El perfil de la empresa no incluye el módulo de Nómina.",
        });
        continue;
      }

      const hoy = nowISO ?? todayForCountry(cfg.company.country);
      const periodo = periodoCerradoEn(hoy, cfg.frequency);

      if (!periodo) {
        resultados.push({
          companyId: cfg.companyId,
          companyName: nombre,
          status: "OMITIDA",
          motivo: cfg.frequency === "SEMANAL"
            ? "Nómina semanal: el ciclo no tiene ancla en la configuración, se procesa a mano."
            : `Hoy (${hoy}) no cierra período para una nómina ${cfg.frequency}.`,
        });
        continue;
      }

      try {
        const run = await PayrollRunService.create(
          cfg.companyId,
          AUTO_DRAFT_ACTOR,
          {
            periodStart: periodo.start,
            periodEnd: periodo.end,
            idempotencyKey: autoDraftKey(periodo.start, periodo.end),
          },
          // Sin IP: la de la infraestructura de Vercel no es la de un actor, y
          // escribirla fabricaría un rastro falso. El user-agent identifica la
          // automatización, que es lo que R-6 quiere saber aquí.
          null,
          AUTO_DRAFT_USER_AGENT,
        );

        resultados.push({
          companyId: cfg.companyId,
          companyName: nombre,
          status: "CREADA",
          runId: run.id,
          periodStart: periodo.start,
          periodEnd: periodo.end,
        });
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        const { status, motivo } = clasificar(mensaje);
        if (status === "FALLIDA") {
          // El detalle va aquí y no al JSON del cron: lleva nombres de
          // trabajadores. Y sin esto un fallo recurrente en una empresa no
          // produciría NINGUNA señal — el console.info sólo emite conteos.
          Sentry.captureException(err, {
            tags: { cron: "payroll-auto-draft", companyId: cfg.companyId },
          });
        }
        resultados.push({
          companyId: cfg.companyId,
          companyName: nombre,
          status,
          motivo,
          periodStart: periodo.start,
          periodEnd: periodo.end,
        });
      }
    }

    return { results: resultados, total, truncated: total > configs.length };
  },
};
