import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import { FileTextIcon, UsersIcon, PackageIcon, LandmarkIcon, BuildingIcon, ShieldCheckIcon } from "lucide-react";
import { VideoModal } from "@/components/landing/VideoModal";
import { LandingMobileNav } from "@/components/landing/LandingMobileNav";
import { LandingClient } from "@/components/landing/LandingClient";
import { LandingDespachos } from "@/components/landing/LandingDespachos";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import styles from "./landing.module.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// ─── Constantes ───────────────────────────────────────────────────────────────

const EARLY_ADOPTER_SLOTS_TOTAL = 10;
const EARLY_ADOPTER_SLOTS_TAKEN = 3;
const SLOTS_LEFT = EARLY_ADOPTER_SLOTS_TOTAL - EARLY_ADOPTER_SLOTS_TAKEN;

const FEATURES: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: "blue" | "gold";
  title: string;
  description: string;
}[] = [
  {
    icon: FileTextIcon,
    iconColor: "blue",
    title: "Facturación Fiscal SENIAT",
    description:
      "Emite facturas, notas de crédito/débito y retenciones conformes a PA 121. Correlativo automático con control de duplicados.",
  },
  {
    icon: UsersIcon,
    iconColor: "gold",
    title: "Nómina Venezolana",
    description:
      "Cálculo automático de cestaticket, utilidades, vacaciones y liquidación según LOTTT. Soporte para múltiples trabajadores.",
  },
  {
    icon: PackageIcon,
    iconColor: "blue",
    title: "Inventario y Almacén",
    description:
      "Control por lotes, seriales y múltiples unidades de medida. Alertas de bajo stock y trazabilidad completa.",
  },
  {
    icon: LandmarkIcon,
    iconColor: "gold",
    title: "Conciliación Bancaria",
    description:
      "Importa extractos bancarios, sugiere asientos automáticamente y detecta diferencias en segundos.",
  },
  {
    icon: BuildingIcon,
    iconColor: "blue",
    title: "Multi-empresa y Roles",
    description:
      "Gestiona varias empresas desde una sola cuenta. Roles diferenciados: Propietario, Admin, Contador, Administrativo, SENIAT.",
  },
  {
    icon: ShieldCheckIcon,
    iconColor: "gold",
    title: "Firma Digital Certificada",
    description:
      "Certifica PDFs con tu certificado P12. Compatible con los estándares SENIAT para documentos fiscales.",
  },
];

const TRUST_ITEMS = [
  "Conforme a PA 121 — SENIAT",
  "Retenciones IVA / ISLR / INCES",
  "Nómina LOTTT Venezuela",
  "Libro Mayor y Diario VEN-NIF",
];

const PLANS = [
  {
    key: "trial",
    name: "Prueba Gratis",
    price: "$0",
    period: "/ 14 días",
    priceSub: null,
    description: "Acceso completo sin tarjeta de crédito.",
    features: [
      { text: "Todas las funcionalidades incluidas", gold: false },
      { text: "Hasta 3 usuarios", gold: false },
      { text: "Soporte por email", gold: false },
    ],
    cta: "Crear cuenta gratis",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: null,
    badgeVariant: null,
  },
  {
    key: "monthly",
    name: "Mensual",
    price: "$59",
    period: "/mes",
    priceSub: null,
    description: "Sin compromisos, cancela cuando quieras.",
    features: [
      { text: "Todas las funcionalidades incluidas", gold: false },
      { text: "Usuarios ilimitados", gold: false },
      { text: "Soporte por email", gold: false },
    ],
    cta: "Activar plan mensual",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: null,
    badgeVariant: null,
  },
  {
    key: "annual",
    name: "Anual",
    price: "$565",
    period: "/año",
    priceSub: "$47/mes — 2 meses gratis incluidos",
    description: "Equivale a 2 meses gratis respecto al plan mensual.",
    features: [
      { text: "Todo lo del plan mensual", gold: false },
      { text: "Ahorra $143 al año", gold: false },
      { text: "Soporte prioritario", gold: false },
    ],
    cta: "Suscribirme anual",
    ctaHref: "/sign-up",
    highlighted: true,
    badge: "Más popular",
    badgeVariant: "pop" as const,
  },
  {
    key: "early_adopter",
    name: "Early Adopter",
    price: "$19",
    period: "/mes · año 1",
    priceSub: "Año 2+: $47/mes · facturado anualmente",
    description: `Primeras ${EARLY_ADOPTER_SLOTS_TOTAL} empresas. Solo quedan ${SLOTS_LEFT} slots.`,
    features: [
      { text: "Todo lo del plan anual", gold: false },
      { text: "Sesión de onboarding 1.5h (videollamada)", gold: false },
      { text: "Chat prioritario el primer mes", gold: true },
      { text: "Precio especial bloqueado para siempre", gold: true },
    ],
    cta: "Reclamar mi slot",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: `${SLOTS_LEFT}/${EARLY_ADOPTER_SLOTS_TOTAL} slots`,
    badgeVariant: "ea" as const,
  },
];

type ComparisonValue = boolean | string;
const COMPARISON_ROWS: { label: string; values: ComparisonValue[] }[] = [
  { label: "Todos los módulos incluidos",   values: [true,      true,         true,          true] },
  { label: "Usuarios",                      values: ["3",       "Ilimitados", "Ilimitados",  "Ilimitados"] },
  { label: "Período",                       values: ["14 días", "Mensual",    "Anual",       "Año 1"] },
  { label: "Soporte",                       values: ["Email",   "Email",      "Prioritario", "Prioritario"] },
  { label: "Onboarding videollamada 1.5 h", values: [false,     false,        false,         true] },
  { label: "Precio especial bloqueado",     values: [false,     false,        false,         true] },
];

// ─── Componente ───────────────────────────────────────────────────────────────

export default async function LandingPage() {
  const { userId } = await auth();
  const isAuthenticated = !!userId;

  return (
    <div
      id="lnd-root"
      className={`${styles.landing} ${plusJakarta.className}`}
      style={{ minHeight: "100vh" }}
    >
      <LandingClient />

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <header className={styles.nav} id="lnd-nav">
        <div className={styles.wrap}>
          <div className={styles.navInner}>
            <Link href="/" className={styles.logo}>
              <div className={styles.logoChip}>⚡</div>
              <span className={styles.logoName}>ContaFlow</span>
            </Link>

            <nav className={styles.navLinks}>
              <Link href="#funcionalidades">Funcionalidades</Link>
              <Link href="#precios">Precios</Link>
            </nav>

            <div className={styles.navCtas}>
              {isAuthenticated ? (
                <Link href="/dashboard" className={styles.btnPill}>
                  Ir al panel
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </Link>
              ) : (
                <>
                  <Link href="/sign-in" className={styles.btnGhost}>Iniciar sesión</Link>
                  <Link href="/sign-up" className={styles.btnPill}>
                    Crear cuenta gratis
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </Link>
                </>
              )}
              <LandingMobileNav isAuthenticated={isAuthenticated} />
            </div>
          </div>
        </div>
      </header>

      <main>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroInner}`}>
          <div className={styles.heroGrid}>
            {/* Copy */}
            <div>
              <div className={styles.hBadge}>Conforme a PA 121 — SENIAT Venezuela</div>
              <h1 className={styles.heroH1}>
                El cierre fiscal que te<br />
                tomaba 3 días,<br />
                <em>ahora son 3 horas.</em>
              </h1>
              <p className={styles.heroCopy}>
                Facturación PA 121, nómina LOTTT, inventario y conciliación bancaria — todo
                integrado. El contador cierra el mes en horas, no en días.
              </p>
              <div className={styles.heroCtas}>
                {isAuthenticated ? (
                  <Link href="/dashboard" className={styles.btnLg}>
                    Ir al panel
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </Link>
                ) : (
                  <>
                    <Link href="/sign-up" className={styles.btnLg}>
                      Crear cuenta gratis — 14 días
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </Link>
                    <Link href="#precios" className={styles.btnLgGhost}>Ver precios</Link>
                  </>
                )}
              </div>
              <p className={styles.heroSub}>Sin tarjeta de crédito · Configuración en 10 min · Cancela cuando quieras</p>
            </div>

            {/* Video card */}
            <VideoModal />
          </div>
        </div>
      </section>

      {/* ── Trust bar ─────────────────────────────────────────────────────── */}
      <div className={styles.trust}>
        <div className={styles.wrap}>
          <ul className={styles.trustList}>
            {TRUST_ITEMS.map((item) => (
              <li key={item} className={styles.trustItem}>
                <svg className={styles.trustIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <section className={styles.stats}>
        <div className={styles.wrap}>
          <div className={styles.statsGrid}>
            {[
              { val: <><span>6</span> módulos</>, desc: "Todo en una sola plataforma", delay: "" },
              { val: <>PA <span>121</span></>, desc: "100% conforme a SENIAT", delay: styles.d1 },
              { val: <><span>14</span> días</>, desc: "Prueba gratis, sin tarjeta", delay: styles.d2 },
              { val: <>USDT <span>+</span></>, desc: "Pago seguro en crypto", delay: styles.d3, tip: "Tether (USDT) es una stablecoin anclada al dólar. Pagas con crypto, sin banco intermediario." },
            ].map(({ val, desc, delay, tip }) => (
              <div
                key={desc}
                className={`${styles.stat} ${styles.reveal} ${delay}`}
                data-reveal
              >
                <div className={styles.statVal}>{val}</div>
                <div
                  className={`${styles.statDesc}${tip ? ` ${styles.usdtTip}` : ""}`}
                  {...(tip ? { "data-tip": tip } : {})}
                >
                  {desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Funcionalidades ───────────────────────────────────────────────── */}
      <section id="funcionalidades" className={`${styles.section} ${styles.sectionTint}`}>
        <div className={styles.wrap}>
          <div className={`${styles.secHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow}>Plataforma completa</p>
            <h2>Todo lo que necesita tu empresa</h2>
            <p>Un solo sistema. Sin módulos separados ni costos ocultos.</p>
          </div>
          <div className={styles.featGrid}>
            {FEATURES.map(({ icon: Icon, iconColor, title, description }, i) => {
              const delays = [styles.d1, styles.d2, styles.d3, styles.d4, styles.d5, styles.d6];
              const iconCls = iconColor === "blue" ? styles.featIconBlue : styles.featIconGold;
              return (
                <div
                  key={title}
                  className={`${styles.featCard} ${styles.reveal} ${delays[i % 3] ?? ""}`}
                  data-reveal
                >
                  <div className={`${styles.featIcon} ${iconCls}`}>
                    <Icon className="" aria-hidden />
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Conciliación bancaria ─────────────────────────────────────────── */}
      <section className={styles.concilia}>
        <div className={styles.conciliaInner}>
          <p className={styles.conciliaTagline}>Módulo destacado</p>
          <h2 className={styles.conciliaH2}>Conciliación bancaria<br />sin dolor de cabeza</h2>
          <p className={styles.conciliaKicker}>
            Antes: extracto bancario + Excel + 3 horas de trabajo.<br />
            Ahora: importa el estado de cuenta, ContaFlow cruza cada movimiento automáticamente.
          </p>
          <ul className={styles.conciliaBullets}>
            {[
              "Importa extractos en segundos",
              "Cruza movimientos automáticamente contra asientos del libro mayor",
              "Detecta diferencias y las resalta para tu revisión",
              "Genera el informe de conciliación con un clic",
            ].map((text) => (
              <li key={text} className={styles.conciliaBullet}>
                <svg className={styles.conciliaCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className={styles.conciliaBulletText}>{text}</span>
              </li>
            ))}
          </ul>
          <div className={styles.conciliaStepper}>
            {[
              { n: "1", title: "Importa el extracto", desc: "Sube el PDF o CSV del banco. ContaFlow lo parsea automáticamente." },
              { n: "2", title: "Revisión automática", desc: "El sistema cruza cada línea con los asientos del libro mayor." },
              { n: "3", title: "Informe listo", desc: "Descarga el informe de conciliación firmado en segundos." },
            ].map(({ n, title, desc }) => (
              <div key={n} className={styles.conciliaStep}>
                <div className={styles.conciliaStepNum}>{n}</div>
                <div className={styles.conciliaStepBody}>
                  <div className={styles.conciliaStepTitle}>{title}</div>
                  <div className={styles.conciliaStepDesc}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Para despachos / multi-empresa ────────────────────────────────── */}
      <LandingDespachos />

      {/* ── ROI Calculator ────────────────────────────────────────────────── */}
      <RoiCalculator />

      {/* ── Precios ───────────────────────────────────────────────────────── */}
      <section id="precios" className={styles.section}>
        <div className={styles.wrap}>
          <div className={`${styles.secHead} ${styles.reveal}`} data-reveal>
            <p className={styles.eyebrow}>Sin sorpresas</p>
            <h2>Precios transparentes</h2>
            <p>Cancela cuando quieras. Pago en USDT (crypto).</p>
          </div>

          <div className={styles.priceGrid}>
            {PLANS.map((plan, i) => {
              const delays = ["", styles.d1, styles.d2, styles.d3];
              return (
                <div
                  key={plan.key}
                  className={`${styles.pc} ${plan.highlighted ? styles.pcHl : ""} ${styles.reveal} ${delays[i]}`}
                  data-reveal
                >
                  {plan.badge && (
                    <span className={`${styles.pcBadge} ${plan.badgeVariant === "pop" ? styles.pcBadgePop : styles.pcBadgeEa}`}>
                      {plan.badge}
                    </span>
                  )}
                  <div className={styles.pcName}>{plan.name}</div>
                  <div className={styles.pcPrice}>
                    <span className="amt">{plan.price}</span>
                    <span className="per">{plan.period}</span>
                  </div>
                  {plan.priceSub && <div className={styles.pcSub}>{plan.priceSub}</div>}
                  <div className={styles.pcDesc}>{plan.description}</div>
                  {plan.key === "early_adopter" && (
                    <div className={styles.eaProgressWrap}>
                      <div className={styles.eaProgressTrack}>
                        <div className={styles.eaProgressFill} />
                      </div>
                      <div className={styles.eaProgressMeta}>
                        <span>{EARLY_ADOPTER_SLOTS_TAKEN} de {EARLY_ADOPTER_SLOTS_TOTAL} slots ocupados</span>
                        <span>{SLOTS_LEFT} disponibles</span>
                      </div>
                    </div>
                  )}
                  <ul className={styles.pcFeats}>
                    {plan.features.map((f) => (
                      <li key={f.text} className={f.gold ? styles.pcFeatsGold : undefined}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={plan.ctaHref}
                    className={`${styles.btnPc} ${plan.highlighted ? styles.btnPcHl : ""}`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Comparison table */}
          <div className={`${styles.cmpWrap} ${styles.reveal}`} data-reveal>
            <div className={styles.cmpTitle}>¿Qué incluye cada plan?</div>
            <div className={styles.cmpOuter}>
              <table>
                <thead>
                  <tr>
                    <th>Característica</th>
                    {PLANS.map((p) => (
                      <th key={p.key} className={p.highlighted ? styles.thHi : undefined}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      {row.values.map((val, j) => (
                        <td key={j} className={PLANS[j]?.highlighted ? styles.tdHi : undefined}>
                          {val === true ? (
                            <svg className={styles.cmpCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="Incluido">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : val === false ? (
                            <span className={styles.cmpDash} aria-label="No incluido">—</span>
                          ) : (
                            <span>{val}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.priceNote}>
              Los precios están en dólares estadounidenses (USD). El pago se procesa en USDT
              (Tether) a través de NOWPayments.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA final ─────────────────────────────────────────────────────── */}
      <section className={styles.cta}>
        <div className={`${styles.wrap} ${styles.ctaInner}`}>
          <h2 className={`${styles.reveal}`} data-reveal>Empieza hoy sin riesgos</h2>
          <p className={`${styles.reveal} ${styles.d1}`} data-reveal>
            14 días con acceso completo a todos los módulos. Sin tarjeta de crédito.
            Si no es lo que necesitas, simplemente no continúas — sin cargos.
          </p>
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className={`${styles.btnLg} ${styles.reveal} ${styles.d2}`}
              data-reveal
            >
              Ir al panel
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Link>
          ) : (
            <Link
              href="/sign-up"
              className={`${styles.btnLg} ${styles.reveal} ${styles.d2}`}
              data-reveal
            >
              Crear cuenta gratis
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </Link>
          )}
        </div>
      </section>

      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footerGrid}>
            {/* Marca */}
            <div>
              <div className={styles.ftLogo}>
                <div className={styles.logoChip}>⚡</div>
                <span className={styles.ftLogoName}>ContaFlow</span>
              </div>
              <p className={styles.ftDesc}>
                Sistema contable profesional venezolano. Facturación fiscal, nómina,
                inventario y más en una sola plataforma.
              </p>
              <div className={styles.ftBadges}>
                <span className={styles.ftBadge}>✓ SENIAT PA 121</span>
                <span className={styles.ftBadge}>✓ VEN-NIF</span>
                <span className={styles.ftBadge}>✓ LOTTT</span>
                <span className={styles.ftBadge}>🔒 Seguro</span>
              </div>
            </div>

            {/* Plataforma */}
            <div>
              <div className={styles.ftTitle}>Plataforma</div>
              <ul className={styles.ftLinks}>
                <li><Link href="#funcionalidades">Funcionalidades</Link></li>
                <li><Link href="#precios">Precios</Link></li>
                <li><Link href="/sign-in">Iniciar sesión</Link></li>
                <li><Link href="/sign-up">Crear cuenta</Link></li>
              </ul>
            </div>

            {/* Soporte */}
            <div>
              <div className={styles.ftTitle}>Soporte</div>
              <ul className={styles.ftLinks}>
                <li><a href="mailto:soporte@contaflow.app">soporte@contaflow.app</a></li>
                <li><Link href="/terms">Términos de servicio</Link></li>
                <li><Link href="/privacy">Política de privacidad</Link></li>
              </ul>
            </div>
          </div>

          <div className={styles.ftBottom}>
            <span>© {new Date().getFullYear()} ContaFlow. Todos los derechos reservados. Sistema contable conforme a PA 121 — Venezuela.</span>
            <div className={styles.ftBottomBadges}>
              <span className={styles.ftBottomBadge}>SSL</span>
              <span className={styles.ftBottomBadge}>NOWPayments</span>
              <span className={styles.ftBottomBadge}>USDT</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
