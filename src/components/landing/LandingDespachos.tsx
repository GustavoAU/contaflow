"use client";

import Link from "next/link";
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
          <p className={styles.despEyebrow}>Multi-empresa y roles</p>
          <h2 className={styles.despH2}>
            Un solo login.<br />Todas tus empresas.
          </h2>
          <p className={styles.despSubtitle}>
            Agrega múltiples empresas a tu cuenta y asigna roles específicos
            a cada miembro de tu equipo. Cada quien ve solo lo que necesita.
          </p>
        </div>

        <div className={styles.despBenefits}>
          {[
            {
              icon: "🏢",
              title: "Sin límite de empresas",
              desc: "Agrega todas las empresas que administras. Sin cuentas adicionales ni costos extra.",
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
          <p className={styles.despCtaSub}>Sin tarjeta de crédito · Cancela cuando quieras</p>
        </div>

      </div>
    </section>
  );
}
