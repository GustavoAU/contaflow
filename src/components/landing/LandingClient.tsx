"use client";

import { useEffect } from "react";
import styles from "@/app/landing.module.css";

export function LandingClient() {
  useEffect(() => {
    document.getElementById("lnd-root")?.classList.add(styles.jsLoaded);

    const nav = document.getElementById("lnd-nav");
    function onScroll() {
      if (!nav) return;
      nav.classList.toggle(styles.navScrolled, window.scrollY > 40);
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealVisible);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));

    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  return null;
}
