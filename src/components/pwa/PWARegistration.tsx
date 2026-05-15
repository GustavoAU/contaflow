"use client";

import { useEffect } from "react";

export function PWARegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // SW registration failure is non-fatal — app functions normally
      });
    }
  }, []);

  return null;
}
