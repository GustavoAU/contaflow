import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import { FileTextIcon, UsersIcon, PackageIcon, LandmarkIcon, BuildingIcon, ShieldCheckIcon } from "lucide-react";
import { VideoModal } from "@/components/landing/VideoModal";
import { LandingMobileNav } from "@/components/landing/LandingMobileNav";
import { LandingClient } from "@/components/landing/LandingClient";
import { LandingDespachos } from "@/components/landing/LandingDespachos";
import { ScreenshotLightbox } from "@/components/landing/ScreenshotLightbox";
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
    title: "Roles y Equipo Ilimitados",
    description:
      "Usuarios ilimitados sin costo extra. Roles diferenciados: Propietario, Admin, Contador, Administrativo y SENIAT. Ideal para equipos de cualquier tamaño.",
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
      { text: "1 empresa (RIF) incluida", gold: false },
      { text: "Todas las funcionalidades", gold: false },
      { text: "Hasta 3 usuarios", gold: false },
      { text: "Soporte por email", gold: false },
      { text: "Sin tarjeta de crédito requerida", gold: false },
      { text: "Conversión al plan de pago con un clic", gold: false },
    ],
    cta: "Crear cuenta gratis",
    ctaHref: "/sign-up",
    highlighted: false,
    originalPrice: null,
    savingsBadge: null,
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
      { text: "1 empresa (RIF) incluida", gold: false },
      { text: "Facturas, nómina e inventario ilimitados", gold: false },
      { text: "Usuarios ilimitados", gold: false },
      { text: "Soporte por email", gold: false },
    ],
    cta: "Activar plan mensual",
    ctaHref: "/sign-up?plan=mensual",
    highlighted: false,
    originalPrice: null,
    savingsBadge: null,
    badge: "Sin compromiso",
    badgeVariant: "mo" as const,
  },
  {
    key: "annual",
    name: "Anual",
    price: "$47",
    period: "/mes",
    priceSub: "Un solo cobro de $565 USDT al año · 12 meses pagados, 14 de acceso",
    description: "Pagas $565 USDT ahora y accedes todo el año. Equivale a $47/mes vs $59 mensual — ahorras $143. Cancela antes del próximo período.",
    features: [
      { text: "1 empresa (RIF) incluida", gold: false },
      { text: "Facturas, nómina e inventario ilimitados", gold: false },
      { text: "Usuarios ilimitados", gold: false },
      { text: "Soporte prioritario — respuesta < 4 h hábiles", gold: false },
    ],
    cta: "Suscribirme anual",
    ctaHref: "/sign-up?plan=anual",
    highlighted: true,
    originalPrice: "$59",
    savingsBadge: "Ahorras $143/año",
    badge: "Más popular",
    badgeVariant: "pop" as const,
  },
  {
    key: "early_adopter",
    name: "Early Adopter",
    price: "$19",
    period: "/mes · año 1",
    priceSub: "Total año 1: $228 USDT · Año 2+: $47/mes facturado anualmente",
    description: `Ahorras $480 en el primer año vs plan mensual. Al vencer, te avisamos 30 días antes — renueva o cancela sin penalización. Solo quedan ${SLOTS_LEFT} cupos.`,
    features: [
      { text: "1 empresa (RIF) incluida", gold: false },
      { text: "Sesión de onboarding 1.5h (videollamada)", gold: false },
      { text: "Chat prioritario el primer mes", gold: true },
      { text: "Precio especial bloqueado para siempre", gold: true },
    ],
    cta: "Reclamar mi slot",
    ctaHref: "/sign-up?plan=early_adopter",
    highlighted: false,
    originalPrice: null,
    savingsBadge: null,
    badge: `${SLOTS_LEFT}/${EARLY_ADOPTER_SLOTS_TOTAL} slots`,
    badgeVariant: "ea" as const,
  },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "¿Puedo cambiar de plan mensual a anual después?",
    a: "Sí, en cualquier momento desde tu panel de cuenta. El cambio se aplica en el próximo período de facturación.",
  },
  {
    q: "¿Qué pasa si no uso los 14 días de prueba completos?",
    a: "Simplemente no continúas. No se requiere tarjeta de crédito y no se genera ningún cargo.",
  },
  {
    q: "¿El precio en USDT equivale exactamente a los dólares mostrados?",
    a: "Sí. USDT (Tether) es una stablecoin: 1 USDT = 1 USD. No hay conversiones ni tasas de cambio variables.",
  },
  {
    q: "¿Puedo cancelar antes del próximo cobro?",
    a: "Sí, cancela en cualquier momento desde tu panel de cuenta. Nunca se te cobrará sin confirmación previa.",
  },
  {
    q: "¿El monto en USDT cambia si el mercado cripto varía?",
    a: "No. USDT está anclado al dólar. Siempre pagas exactamente el monto en USD mostrado — sin sorpresas por volatilidad.",
  },
];

type ComparisonValue = boolean | string;
const COMPARISON_ROWS: { label: string; values: ComparisonValue[] }[] = [
  { label: "Empresas (RIF) incluidas",      values: ["1",       "1",          "1",           "1"] },
  { label: "Todos los módulos incluidos",   values: [true,      true,         true,          true] },
  { label: "Usuarios",                      values: ["3",       "Ilimitados", "Ilimitados",  "Ilimitados"] },
  { label: "Período",                       values: ["14 días", "Mensual",    "Anual",       "Año 1"] },
  { label: "Soporte",                       values: ["Email",   "Email",      "< 4 h hábiles", "< 4 h hábiles"] },
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
      {/* Skip-to-content — WCAG 2.4.1 (A): Bypass Blocks */}
      <a
        href="#main-content"
        className={styles.skipLink}
      >
        Saltar al contenido
      </a>

      <LandingClient />

      {/* ── Top banner — Early Adopter urgency ──────────────────────────── */}
      <div className={styles.topBanner}>
        <div className={styles.wrap}>
          <div className={styles.topBannerInner}>
            <p className={styles.topBannerText}>
              ⚡ Solo quedan <strong>{SLOTS_LEFT} cupos Early Adopter</strong> — $19/mes · Año 1
            </p>
            <Link href="/sign-up?plan=early_adopter" className={styles.topBannerLink}>
              Reclamar mi slot →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <header className={styles.nav} id="lnd-nav">
        <div className={styles.wrap}>
          <div className={styles.navInner}>
            <Link href="/" className={styles.logo}>
              <div className={styles.logoChip}>⚡</div>
              <span className={styles.logoName}>ContaFlow</span>
            </Link>

            {/* aria-label distingue esta nav de la mobile nav — WCAG 1.3.1 */}
            <nav aria-label="Navegación principal" className={styles.navLinks}>
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

      <main id="main-content">

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
              <a href="#roi" className={styles.heroRoiLink}>¿Cuánto tiempo recuperas al mes? → Calcularlo</a>
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
              { val: <>Bs. <span>+</span> $</>, desc: "Multi-moneda · VES y USD", delay: styles.d3 },
            ].map(({ val, desc, delay }) => (
              <div
                key={desc}
                className={`${styles.stat} ${styles.reveal} ${delay}`}
                data-reveal
              >
                <div className={styles.statVal}>{val}</div>
                <div className={styles.statDesc}>{desc}</div>
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

          {/* Screenshot duo — Libro IVA + Estado de Resultados */}
          <div className={`${styles.screenshotDuo} ${styles.reveal} ${styles.d1}`} data-reveal>
            <div className={styles.screenshotItem}>
              <div className={styles.screenshotFrame}>
                <ScreenshotLightbox
                  src="/screenshots/libro-iva.jpg"
                  alt="Libros IVA compras ContaFlow"
                  width={1280}
                  height={840}
                />
              </div>
              <p className={styles.screenshotCaption}>Libros IVA Compras y Ventas — conformes a PA 121</p>
            </div>
            <div className={styles.screenshotItem}>
              <div className={styles.screenshotFrame}>
                <ScreenshotLightbox
                  src="/screenshots/estado-resultados.jpg"
                  alt="Estado de Resultados VEN-NIF ContaFlow"
                  width={1280}
                  height={840}
                />
              </div>
              <p className={styles.screenshotCaption}>Estado de Resultados VEN-NIF — generado automáticamente</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Declaración IVA Forma 30 ──────────────────────────────────────── */}
      <section className={styles.ivaSection}>
        <div className={styles.wrap}>
          <div className={styles.ivaInner}>
            <div className={`${styles.reveal}`} data-reveal>
              <div className={styles.screenshotFrame}>
                <ScreenshotLightbox
                  src="/screenshots/declaracion-iva.jpg"
                  alt="Declaración IVA Forma 30 ContaFlow"
                  width={1280}
                  height={840}
                />
              </div>
            </div>
            <div className={`${styles.reveal} ${styles.d1}`} data-reveal>
              <p className={styles.conciliaTagline}>Cumplimiento fiscal automático</p>
              <h2 className={styles.conciliaH2}>Declaración IVA<br />Forma 30, lista al instante</h2>
              <p className={styles.conciliaKicker}>
                ContaFlow genera la Forma 30 desde tus asientos.<br />
                Sin errores manuales, sin exportar a Excel.
              </p>
              <ul className={styles.conciliaBullets}>
                {[
                  "Secciones A, B, C, D y E calculadas automáticamente",
                  "Alícuotas 16%, 8% y Lujo 31% según VEN-NIF",
                  "Retenciones IVA incluidas en el cálculo final",
                  "Exporta el PDF listo para declarar ante el SENIAT",
                ].map((text) => (
                  <li key={text} className={styles.conciliaBullet}>
                    <svg className={styles.conciliaCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className={styles.conciliaBulletText}>{text}</span>
                  </li>
                ))}
              </ul>
              <div className={styles.sectionCtaWrap}>
                <Link href={isAuthenticated ? "/dashboard" : "/sign-up"} className={styles.btnSectionCta}>
                  {isAuthenticated ? "Ir al panel →" : "Probar gratis — sin tarjeta →"}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Conciliación bancaria ─────────────────────────────────────────── */}
      <section className={styles.concilia}>
        <div className={styles.wrap}>
        <div className={styles.conciliaInner}>
          {/* Left col — copy */}
          <div className={`${styles.reveal}`} data-reveal>
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
            <div className={styles.sectionCtaWrap}>
              <Link href={isAuthenticated ? "/dashboard" : "/sign-up"} className={styles.btnSectionCta}>
                {isAuthenticated ? "Ir al panel →" : "Probar gratis — sin tarjeta →"}
              </Link>
            </div>
          </div>
          {/* Right col — screenshot */}
          <div className={`${styles.reveal} ${styles.d1}`} data-reveal>
            <div className={styles.screenshotFrame}>
              <ScreenshotLightbox
                src="/screenshots/conciliacion.jpg"
                alt="Workbench de conciliación bancaria ContaFlow"
                width={1280}
                height={840}
              />
            </div>
          </div>
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
            <p>Pago en USDT · Mensual: cancela cuando quieras · Anual: cancela antes del próximo período</p>
            <details className={styles.usdtExpand}>
              <summary className={styles.usdtExpandSummary}>
                ¿Cómo funciona el pago en USDT?
              </summary>
              <div className={styles.usdtExpandBody}>
                USDT es una criptomoneda estable equivalente al dólar (1 USDT = 1 USD).
                Puedes obtenerla en cualquier exchange local como Binance P2P.
                El cobro se procesa vía NOWPayments — el proceso toma menos de 5 minutos.
              </div>
            </details>
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
                    <span className={`${styles.pcBadge} ${plan.badgeVariant === "pop" ? styles.pcBadgePop : plan.badgeVariant === "mo" ? styles.pcBadgeMo : styles.pcBadgeEa}`}>
                      {plan.badge}
                    </span>
                  )}
                  <div className={styles.pcName}>{plan.name}</div>
                  <div className={styles.pcPrice}>
                    {plan.originalPrice && (
                      <span className={styles.pcOriginalPrice}>{plan.originalPrice}</span>
                    )}
                    <span className="amt">{plan.price}</span>
                    <span className="per">{plan.period}</span>
                  </div>
                  {plan.savingsBadge && <div className={styles.pcSavingsBadge}>{plan.savingsBadge}</div>}
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
                    className={`${styles.btnPc} ${plan.highlighted ? styles.btnPcHl : ""} ${plan.key === "monthly" ? styles.btnPcSolid : ""}`}
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
                    {/* scope="col" — WCAG 1.3.1 (A): relación semántica cabecera-columna */}
                    <th scope="col">Característica</th>
                    {PLANS.map((p) => (
                      <th key={p.key} scope="col" className={p.highlighted ? styles.thHi : undefined}>
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
            <p className={styles.priceNote} style={{ marginTop: "0.75rem" }}>
              ¿Eres contador independiente o despacho con múltiples RIFs?{" "}
              <a href="mailto:info@contaflow.app" style={{ color: "var(--c-blue)", textDecoration: "underline" }}>
                Contáctanos para planes multi-empresa con descuento por volumen.
              </a>
            </p>

            {/* FAQ */}
            <div className={styles.faqWrap}>
              <div className={styles.faqTitle}>Preguntas frecuentes</div>
              {FAQ_ITEMS.map(({ q, a }) => (
                <details key={q} className={styles.faqItem}>
                  <summary>{q}</summary>
                  <div className={styles.faqBody}>{a}</div>
                </details>
              ))}
            </div>
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
                <span className={styles.ftBadge}>SSL seguro</span>
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
