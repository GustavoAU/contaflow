"use client";

import Link from "next/link";
import { ScreenshotLightbox } from "@/components/landing/ScreenshotLightbox";
import styles from "@/app/landing.module.css";

const ROLES = [
  {
    emoji: "👑",
    name: "Propietario",
    desc: "Ve todo: finanzas, nómina, reportes y configuración.",
  },
  {
    emoji: "📊",
    name: "Contador",
    desc: "Asientos, libros IVA, retenciones, cierre de período.",
  },
  {
    emoji: "🗂️",
    name: "Administrativo",
    desc: "Facturas, pedidos, inventario, CxC/CxP. Sin acceso a finanzas.",
  },
  {
    emoji: "🔍",
    name: "Auditor SENIAT",
    desc: "Solo lectura: libros IVA, retenciones y declaraciones.",
  },
];

export function LandingDespachos() {
  return (
    <section id="para-despachos" className={styles.despachos}>
      <div className={`${styles.despInner} ${styles.wrap}`}>

        <div className={styles.despHead}>
          <p className={styles.despEyebrow}>Para despachos contables</p>
          <h2 className={styles.despH2}>
            Un solo login.<br />Todos tus clientes.
          </h2>
          <p className={styles.despSubtitle}>
            ContaFlow está diseñado para despachos. Gestiona los RIFs de tus clientes
            desde una sola cuenta, con roles diferenciados para cada miembro de tu equipo.
          </p>
        </div>

        {/* Multi-empresa screenshot */}
        <div className={styles.despScreenshot}>
          <div className={styles.despScreenshotFrame}>
            <ScreenshotLightbox
              src="/screenshots/multi-empresa.jpg"
              alt="Vista multi-empresa ContaFlow — todas tus empresas en un solo dashboard"
              width={1280}
              height={840}
            />
          </div>
        </div>

        <div className={styles.despBenefits}>
          {[
            {
              icon: "🏢",
              title: "Multi-empresa desde un solo login",
              desc: "Gestiona los RIFs de tus clientes desde una sola cuenta. Plan despacho disponible con descuento por volumen.",
            },
            {
              icon: "🔐",
              title: "Roles con permisos granulares",
              desc: "Cuatro roles predefinidos. El contador cierra el período; el administrativo opera; el SENIAT solo audita.",
            },
            {
              icon: "⚡",
              title: "Cambio instantáneo",
              desc: "Alterna entre empresas en un clic. Sin cerrar sesión ni reconfigurar nada.",
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} className={styles.despBenefit}>
              <span className={styles.despBenefitIcon}>{icon}</span>
              <div>
                <div className={styles.despBenefitTitle}>{title}</div>
                <div className={styles.despBenefitDesc}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Roles grid */}
        <div className={styles.despRoles}>
          {ROLES.map(({ emoji, name, desc }) => (
            <div key={name} className={styles.despRoleCard}>
              <div className={styles.despRoleEmoji}>{emoji}</div>
              <div className={styles.despRoleName}>{name}</div>
              <div className={styles.despRoleDesc}>{desc}</div>
            </div>
          ))}
        </div>

        <div className={styles.despCta}>
          <Link href="/sign-up" className={styles.btnPill}>
            Probar gratis 14 días
          </Link>
          <a
            href="mailto:info@contaflow.app?subject=Plan%20despacho%20multi-empresa"
            className={styles.btnGhost}
          >
            Consultar plan despacho →
          </a>
          <p className={styles.despCtaSub}>Sin tarjeta de crédito · Descuento por volumen para despachos</p>
        </div>

      </div>
    </section>
  );
}
