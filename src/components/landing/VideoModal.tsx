"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Play, ArrowRight } from "lucide-react";
import styles from "@/app/landing.module.css";

export function VideoModal() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Keyboard close + scroll lock
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  // WCAG 4.1.2: mover foco al dialog al abrir; restaurar al trigger al cerrar
  useEffect(() => {
    if (open) {
      // pequeño delay para que el DOM esté montado
      const t = setTimeout(() => closeRef.current?.focus(), 40);
      return () => clearTimeout(t);
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      {/* Video card — shown inside the hero */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className={styles.videoCard}
        aria-label="Ver demo en video"
        aria-haspopup="dialog"
        type="button"
      >
        <div className={styles.videoThumbBg}>
          {/* Mini dashboard mockup — aria-hidden, puramente decorativo */}
          <div className={styles.vtMockup} aria-hidden="true">
            {/* Sidebar strip */}
            <div className={styles.vtSb}>
              <div className={styles.vtSbLogo} />
              <div className={`${styles.vtSbItem} ${styles.vtSbActive}`} />
              <div className={styles.vtSbItem} />
              <div className={styles.vtSbItem} />
              <div className={styles.vtSbItem} />
              <div className={styles.vtSbItem} />
            </div>
            {/* Main panel */}
            <div className={styles.vtMain}>
              {/* Topbar */}
              <div className={styles.vtTopbar}>
                <div className={`${styles.vtTopbarPill} ${styles.vtPlLg}`} />
                <div className={`${styles.vtTopbarPill} ${styles.vtPlSm}`} />
                <div className={`${styles.vtTopbarPill} ${styles.vtPlXs}`} />
                <div className={styles.vtTopbarDot} />
              </div>
              {/* KPI cards */}
              <div className={styles.vtKpis}>
                <div className={`${styles.vtKpi} ${styles.vtKpiBlue}`}>
                  <div className={styles.vtKpiLbl} /><div className={styles.vtKpiVal} />
                </div>
                <div className={`${styles.vtKpi} ${styles.vtKpiGreen}`}>
                  <div className={styles.vtKpiLbl} /><div className={styles.vtKpiVal} />
                </div>
                <div className={`${styles.vtKpi} ${styles.vtKpiRed}`}>
                  <div className={styles.vtKpiLbl} /><div className={styles.vtKpiVal} />
                </div>
                <div className={`${styles.vtKpi} ${styles.vtKpiGold}`}>
                  <div className={styles.vtKpiLbl} /><div className={styles.vtKpiVal} />
                </div>
              </div>
              {/* Table rows */}
              <div className={styles.vtTable}>
                {([
                  { type: "header" },
                  { type: "green" },
                  { type: "amber" },
                  { type: "green" },
                  { type: "green" },
                ] as const).map((row, i) => (
                  <div
                    key={i}
                    className={`${styles.vtTrow} ${row.type === "header" ? styles.vtTrowHd : ""}`}
                  >
                    <div className={`${styles.vtTcell} ${styles.vtTcellMain}`} />
                    <div className={`${styles.vtTcell} ${styles.vtTcellSub}`} />
                    <div className={`${styles.vtTcell} ${styles.vtTcellBadge} ${
                      row.type === "green" ? styles.vtBadgeGreen :
                      row.type === "amber" ? styles.vtBadgeAmber : ""
                    }`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Brand overlay — legible sobre el mockup */}
          <div className={styles.vtOverlay}>
            <span className={styles.vtBrand}>⚡ ContaFlow</span>
            <span className={styles.vtSub}>Sistema Contable Venezolano</span>
          </div>
        </div>
        <div className={styles.playBtn}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </div>
        <div className={styles.videoLabel}>Ver demo — 3 min</div>
      </button>

      {/* Modal overlay — WCAG 4.1.2: role=dialog + aria-modal + foco gestionado */}
      {open && (
        <div
          className={styles.vModalOverlay}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Demo de ContaFlow"
        >
          <div className={styles.vBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.vTop}>
              <span className={styles.vTopTitle}>⚡ ContaFlow — Demo del sistema</span>
              <button
                ref={closeRef}
                className={styles.vClose}
                onClick={close}
                aria-label="Cerrar demo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.vPlayer}>
              {/*
                Cuando el video esté listo, reemplazar el div .vComing con:
                <iframe
                  src="URL_DEL_VIDEO"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full border-0"
                />
              */}
              <div className={styles.vComing}>
                <div className={styles.vComingChip}>
                  <Play size={12} aria-hidden />
                  Próximamente
                </div>
                <h3 className={styles.vComingTitle}>Demo del sistema</h3>
                <p className={styles.vComingSub}>
                  Estamos preparando el video de demostración.<br />
                  Mientras tanto, crea tu cuenta gratis y explora la plataforma.
                </p>
                <Link
                  href="/sign-up"
                  className={styles.vComingBtn}
                  onClick={close}
                >
                  Crear cuenta gratis — 14 días
                  <ArrowRight size={13} aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
