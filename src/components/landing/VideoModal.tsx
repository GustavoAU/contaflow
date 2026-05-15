"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "@/app/landing.module.css";

export function VideoModal() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

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

  return (
    <>
      {/* Video card — shown inside the hero */}
      <button
        onClick={() => setOpen(true)}
        className={styles.videoCard}
        aria-label="Ver demo en video"
        type="button"
      >
        <div className={styles.videoThumbBg}>
          <span className={styles.vtBrand}>⚡ ContaFlow</span>
          <span className={styles.vtSub}>Sistema Contable Venezolano</span>
        </div>
        <div className={styles.playBtn}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </div>
        <div className={styles.videoLabel}>Ver demo — 3 min</div>
      </button>

      {/* Modal overlay */}
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
              <button className={styles.vClose} onClick={close} aria-label="Cerrar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.vPlayer}>
              {/* Replace with: <iframe id="vFrame" src="YOUR_VIDEO_EMBED_URL" allowFullScreen /> */}
              <div className={styles.vPlaceholder}>
                <div className={styles.vPlaceholderIcon}>🎬</div>
                <div className={styles.vPlaceholderText}>
                  <strong>Demo próximamente disponible</strong>
                  Reemplaza este bloque con la URL de tu video.<br />
                  Compatible con YouTube, Vimeo o Loom.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
