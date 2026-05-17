"use client";

import { useState } from "react";
import styles from "@/app/landing.module.css";

const COMPANIES = [
  {
    id: "anzola",
    label: "Constructora Anzola C.A.",
    period: "Abril 2026",
    role: "Contador",
    kpis: [
      { label: "Facturas emitidas", val: "23", sub: "18 cobradas" },
      { label: "CxC pendiente", val: "Bs. 1.240.000", sub: "4 clientes" },
      { label: "CxP pendiente", val: "Bs. 418.000", sub: "3 proveedores" },
    ],
    caption: "Correlativo PA-121 automático. Retenciones IVA / ISLR generadas al instante.",
  },
  {
    id: "rojas",
    label: "Distribuidora Rojas S.R.L.",
    period: "Abril 2026",
    role: "Propietario",
    kpis: [
      { label: "Facturas emitidas", val: "47", sub: "41 cobradas" },
      { label: "CxC pendiente", val: "Bs. 3.890.000", sub: "12 clientes" },
      { label: "CxP pendiente", val: "Bs. 756.000", sub: "7 proveedores" },
    ],
    caption: "Multi-empresa desde una sola cuenta. Cambia de empresa en un clic.",
  },
  {
    id: "medina",
    label: "Farmacia Medina",
    period: "Mayo 2026",
    role: "Administrador",
    kpis: [
      { label: "Facturas emitidas", val: "12", sub: "10 cobradas" },
      { label: "CxC pendiente", val: "Bs. 580.000", sub: "2 clientes" },
      { label: "CxP pendiente", val: "Bs. 124.000", sub: "4 proveedores" },
    ],
    caption: "Roles diferenciados: el administrador opera, el contador causa asientos.",
  },
] as const;

export function LandingDespachos() {
  const [active, setActive] = useState<string>("anzola");
  const company = COMPANIES.find((c) => c.id === active) ?? COMPANIES[0];

  return (
    <section id="para-despachos" className={styles.despachos}>
      <div className={styles.despInner}>
        <div className={styles.despHead}>
          <p className={styles.despEyebrow}>Para cada tipo de empresa</p>
          <h2 className={styles.despH2}>
            Una sola plataforma,<br />múltiples empresas
          </h2>
          <p className={styles.despSubtitle}>
            Gestiona varias empresas desde tu cuenta. Roles diferenciados para contadores,
            propietarios y administrativos — cada quien ve solo lo que necesita.
          </p>
        </div>

        <div className={styles.despBenefits}>
          {[
            { icon: "🏢", title: "Multi-empresa", desc: "Agrega empresas sin límite. Cambia entre ellas en un clic." },
            { icon: "🔐", title: "Roles por empresa", desc: "Propietario, Contador, Administrativo, SENIAT — acceso granular." },
            { icon: "📋", title: "Un solo login", desc: "Una cuenta, todas tus empresas. Sin contraseñas adicionales." },
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

        <div className={styles.despSelector}>
          <div className={styles.despTabs}>
            {COMPANIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`${styles.despTabBtn} ${active === c.id ? styles.despTabActive : ""}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className={styles.despPanels}>
            <div className={styles.despMeta}>
              <span>Período: {company.period}</span>
              <span>·</span>
              <span>Rol: {company.role}</span>
            </div>

            <div className={styles.despMockup}>
              {company.kpis.map(({ label, val, sub }) => (
                <div key={label} className={styles.despKpi}>
                  <div className={styles.despKpiLabel}>{label}</div>
                  <div className={styles.despKpiVal}>{val}</div>
                  <div className={styles.despKpiSub}>{sub}</div>
                </div>
              ))}
            </div>

            <p className={styles.despCaption}>{company.caption}</p>
          </div>
        </div>

        <div className={styles.despCta}>
          <a href="/sign-up" className={styles.btnPill ?? ""}>
            Probar gratis 14 días
          </a>
          <p className={styles.despCtaSub}>Sin tarjeta de crédito · Cancela cuando quieras</p>
        </div>
      </div>
    </section>
  );
}
