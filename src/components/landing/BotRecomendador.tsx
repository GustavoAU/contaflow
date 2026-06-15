// src/components/landing/BotRecomendador.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import {
  CheckCircle2Icon,
  XCircleIcon,
  UserIcon,
  BuildingIcon,
  LayoutGridIcon,
  ArrowRightIcon,
  SparklesIcon,
} from "lucide-react";
import styles from "@/app/landing.module.css";

type ProfileId = "SOLO" | "EMPRESA" | "DESPACHO";

const PROFILES = [
  {
    id: "SOLO" as ProfileId,
    Icon: UserIcon,
    iconBg: "linear-gradient(135deg, oklch(0.56 0.22 258), oklch(0.40 0.25 258))",
    label: "Individual",
    tagline: "Un RIF, tus propias cuentas",
    description:
      "Para contadores independientes o dueños que manejan sus finanzas sin equipo dedicado.",
    includes: [
      "Facturación fiscal PA 121 completa",
      "Contabilidad VEN-NIF — Libro Mayor y Diario",
      "Retenciones IVA / ISLR / INCES",
      "Declaración IVA Forma 30 automática",
      "Reportes y exportación PDF / Excel",
      "Portal de clientes para cobros CxC",
    ],
    excluded: ["Nómina y gestión de personal", "Control de inventario y COGS"],
    roiHours: "8–12",
    price: "$47",
    pricePeriod: "/mes · plan anual",
    priceAlt: "o $59/mes sin compromiso",
    accentColor: "oklch(0.50 0.25 258)",
    accentDim: "oklch(0.50 0.25 258 / 0.10)",
    popular: false,
    comingSoon: false,
  },
  {
    id: "EMPRESA" as ProfileId,
    Icon: BuildingIcon,
    iconBg: "linear-gradient(135deg, oklch(0.55 0.18 145), oklch(0.38 0.20 145))",
    label: "Empresa",
    tagline: "Equipo, nómina e inventario",
    description:
      "Para empresas con equipo contable, empleados y movimiento de productos o servicios.",
    includes: [
      "Todo lo del perfil Individual",
      "Nómina LOTTT — cestaticket, utilidades, vacaciones",
      "Inventario con COGS automático al facturar",
      "Órdenes de compra y venta integradas",
      "Presupuestos y proyecciones de caja",
      "Distribución de ingresos entre cuentas",
    ],
    excluded: [],
    roiHours: "18–25",
    price: "$47",
    pricePeriod: "/mes · plan anual",
    priceAlt: "o $59/mes sin compromiso",
    accentColor: "oklch(0.52 0.18 145)",
    accentDim: "oklch(0.52 0.18 145 / 0.10)",
    popular: true,
    comingSoon: false,
  },
  {
    id: "DESPACHO" as ProfileId,
    Icon: LayoutGridIcon,
    iconBg: "linear-gradient(135deg, oklch(0.50 0.20 290), oklch(0.35 0.22 290))",
    label: "Despacho",
    tagline: "Múltiples RIFs bajo un operador",
    description:
      "Para grupos empresariales o despachos contables que gestionan más de un RIF a la vez.",
    includes: [
      "Todo lo del perfil Empresa",
      "Múltiples RIFs vinculados en un solo panel",
      "Vista consolidada del grupo económico",
      "Facturación y reportes inter-empresa",
    ],
    excluded: [],
    roiHours: "30+",
    price: "Próximamente",
    pricePeriod: "",
    priceAlt: "Lista de espera abierta",
    accentColor: "oklch(0.50 0.20 290)",
    accentDim: "oklch(0.50 0.20 290 / 0.10)",
    popular: false,
    comingSoon: true,
  },
] as const;

function cookieAndGo(profileId: ProfileId, href: string) {
  document.cookie = `cf-pending-profile=${profileId};max-age=1800;path=/;SameSite=Lax`;
  window.location.href = href;
}

export function BotRecomendador() {
  const [selected, setSelected] = useState<ProfileId | null>(null);
  const recoRef = useRef<HTMLDivElement>(null);

  const profile = PROFILES.find((p) => p.id === selected) ?? null;

  useEffect(() => {
    if (selected && recoRef.current) {
      setTimeout(() => {
        recoRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    }
  }, [selected]);

  return (
    <section id="recomiendame" className={styles.botSection}>
      <div className={styles.wrap}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className={`${styles.secHead} ${styles.botHead} reveal`} data-reveal>
          <p className={styles.eyebrow}>Encuentra tu punto de partida</p>
          <h2>¿Cuál describe mejor tu empresa?</h2>
          <p>Selecciona un perfil y te mostramos exactamente qué módulos activas desde el primer día.</p>
        </div>

        {/* ── Cards ───────────────────────────────────────────────────────── */}
        <div className={styles.botCards}>
          {PROFILES.map(({ id, Icon, iconBg, label, tagline, description, includes, excluded, popular, comingSoon, accentColor, accentDim }) => {
            const isSelected = selected === id;
            return (
              <button
                key={id}
                type="button"
                disabled={comingSoon}
                onClick={() => !comingSoon && setSelected(isSelected ? null : id)}
                className={`${styles.botCard} ${isSelected ? styles.botCardSelected : ""} ${comingSoon ? styles.botCardDisabled : ""}`}
                style={isSelected ? { borderColor: accentColor, boxShadow: `0 0 0 4px ${accentDim}, 0 8px 32px oklch(0.1 0.04 258 / 0.08)` } : undefined}
                aria-pressed={isSelected}
              >
                {popular && !comingSoon && (
                  <span className={styles.botCardPopular}>⭐ Más popular</span>
                )}
                {comingSoon && (
                  <span className={styles.botCardSoon}>Próximamente</span>
                )}

                {/* Icon */}
                <div className={styles.botCardIconWrap} style={{ background: iconBg }}>
                  <Icon className={styles.botCardIconSvg} aria-hidden />
                </div>

                <div className={styles.botCardLabel}>{label}</div>
                <div className={styles.botCardTagline}>{tagline}</div>
                <p className={styles.botCardDesc}>{description}</p>

                <ul className={styles.botCardList}>
                  {includes.map((f) => (
                    <li key={f} className={styles.botCardListItem}>
                      <CheckCircle2Icon
                        className={styles.botCardCheckIcon}
                        style={{ color: accentColor }}
                        aria-hidden
                      />
                      {f}
                    </li>
                  ))}
                  {excluded.map((f) => (
                    <li key={f} className={`${styles.botCardListItem} ${styles.botCardExcluded}`}>
                      <XCircleIcon className={styles.botCardCheckIcon} aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>

                {isSelected && (
                  <div
                    className={styles.botCardConfirm}
                    style={{ background: accentColor }}
                  >
                    ✓ Seleccionado — ver recomendación ↓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Panel de recomendación ──────────────────────────────────────── */}
        {selected && profile && (
          <div ref={recoRef} className={styles.botReco} style={{ borderColor: profile.accentColor }}>
            <div className={styles.botRecoInner}>

              {/* Left: feature list */}
              <div className={styles.botRecoLeft}>
                <div
                  className={styles.botRecoTag}
                  style={{ background: profile.accentDim, color: profile.accentColor }}
                >
                  <SparklesIcon className={styles.botRecoTagIcon} aria-hidden />
                  Perfil recomendado
                </div>

                <h3 className={styles.botRecoTitle}>
                  Perfil <em style={{ color: profile.accentColor, fontStyle: "normal" }}>{profile.label}</em> — lo que activas hoy
                </h3>

                <ul className={styles.botRecoList}>
                  {profile.includes.map((f) => (
                    <li key={f} className={styles.botRecoListItem}>
                      <CheckCircle2Icon
                        className={styles.botRecoCheckIcon}
                        style={{ color: profile.accentColor }}
                        aria-hidden
                      />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className={styles.botRecoRoi}>
                  ⏱ Ahorro estimado: <strong>{profile.roiHours}h/mes</strong> en trabajo administrativo (según operaciones similares)
                </div>
              </div>

              {/* Right: price + CTA */}
              <div className={styles.botRecoRight}>
                <div className={styles.botRecoPriceCard} style={{ borderColor: profile.accentColor }}>
                  {profile.comingSoon ? (
                    <>
                      <p className={styles.botRecoPriceLabel}>Disponibilidad</p>
                      <div className={styles.botRecoComingSoon}>Próximamente</div>
                      <p className={styles.botRecoPriceAlt}>{profile.priceAlt}</p>
                      <button
                        className={styles.botRecoCta}
                        style={{ background: profile.accentColor }}
                        onClick={() => cookieAndGo(profile.id, "/sign-up")}
                      >
                        Unirme a la lista de espera
                        <ArrowRightIcon className={styles.botRecoCtaIcon} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <p className={styles.botRecoPriceLabel}>Comienza desde</p>
                      <div className={styles.botRecoPriceAmount}>
                        {profile.price}
                        <span className={styles.botRecoPricePeriod}>{profile.pricePeriod}</span>
                      </div>
                      <p className={styles.botRecoPriceAlt}>{profile.priceAlt}</p>

                      <button
                        className={styles.botRecoCta}
                        style={{ background: profile.accentColor }}
                        onClick={() => cookieAndGo(profile.id, `/sign-up?profile=${profile.id}`)}
                      >
                        Comenzar con perfil {profile.label}
                        <ArrowRightIcon className={styles.botRecoCtaIcon} aria-hidden />
                      </button>

                      <button
                        className={styles.botRecoCtaGhost}
                        onClick={() => cookieAndGo(profile.id, "/sign-up")}
                      >
                        Probar 14 días gratis — sin tarjeta
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
