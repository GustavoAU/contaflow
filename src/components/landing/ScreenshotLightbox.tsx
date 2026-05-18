"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { XIcon, ZoomInIcon } from "lucide-react";
import styles from "@/app/landing.module.css";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
};

export function ScreenshotLightbox({ src, alt, width, height, priority }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div
        className={styles.screenshotClickable}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
        aria-label={`Ampliar: ${alt}`}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={styles.screenshotImg}
          priority={priority}
        />
        <div className={styles.screenshotZoomHint} aria-hidden>
          <ZoomInIcon className={styles.screenshotZoomIcon} />
        </div>
      </div>

      {open &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className={styles.lbOverlay}
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal
            aria-label={alt}
          >
            <button
              className={styles.lbClose}
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              <XIcon />
            </button>
            <div className={styles.lbImgWrap} onClick={(e) => e.stopPropagation()}>
              <Image
                src={src}
                alt={alt}
                width={1920}
                height={1200}
                className={styles.lbImg}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
