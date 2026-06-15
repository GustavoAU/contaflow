"use client";

import { useState, useMemo } from "react";
import styles from "@/app/landing.module.css";

const HOURLY_RATE_USD = 10;
const REDUCTION_FACTOR = 0.65;
const PLAN_COST_USD = 59;

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function RoiCalculator() {
  const [clients, setClients] = useState(10);
  const [hoursPerClient, setHoursPerClient] = useState(6);

  const { totalHours, savedHours, savedUsd, netRoi, breakEven } = useMemo(() => {
    const totalHours = clients * hoursPerClient;
    const savedHours = Math.round(totalHours * REDUCTION_FACTOR);
    const savedUsd = savedHours * HOURLY_RATE_USD;
    const netRoi = savedUsd - PLAN_COST_USD;
    const breakEven = netRoi > 0;
    return { totalHours, savedHours, savedUsd, netRoi, breakEven };
  }, [clients, hoursPerClient]);

  return (
    <section id="roi" className={styles.roi}>
      <div className={styles.roiCard}>
        <div className={`${styles.secHead}`} style={{ textAlign: "center", marginBottom: "2rem" }}>
          <p className={styles.eyebrow}>Calculadora de ROI</p>
          <h2 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
            ¿Cuánto tiempo recuperas?
          </h2>
          <p style={{ color: "var(--c-text-2, #6b7280)", maxWidth: "480px", margin: "0 auto" }}>
            Ajusta los valores según tu operación y calcula el ahorro mensual real.
          </p>
        </div>

        <div className={styles.roiInputs}>
          <div className={styles.roiInputGroup}>
            <label>
              Clientes / empresas atendidas
              <span className={styles.roiVal}>{clients}</span>
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={clients}
              onChange={(e) => setClients(Number(e.target.value))}
              className={styles.roiSlider}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#9ca3af" }}>
              <span>1</span><span>30</span>
            </div>
          </div>

          <div className={styles.roiInputGroup}>
            <label>
              Horas admin. por cliente / mes
              <span className={styles.roiVal}>{hoursPerClient}h</span>
            </label>
            <input
              type="range"
              min={2}
              max={20}
              value={hoursPerClient}
              onChange={(e) => setHoursPerClient(Number(e.target.value))}
              className={styles.roiSlider}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#9ca3af" }}>
              <span>2h</span><span>20h</span>
            </div>
          </div>
        </div>

        <div className={styles.roiDivider} />

        <div className={styles.roiResult}>
          <div className={styles.roiSavings}>
            ${fmt(savedUsd)} <span>/ mes</span>
          </div>
          <div className={styles.roiSavingsSub}>
            Ahorro estimado ({savedHours}h recuperadas de {totalHours}h totales)
          </div>
        </div>

        <div className={styles.roiBreakdown}>
          <div className={styles.roiBreakdownItem}>
            <span className={styles.roiBreakdownVal}>{totalHours}h</span>
            <span className={styles.roiBreakdownLabel}>Horas actuales</span>
          </div>
          <div className={styles.roiBreakdownItem}>
            <span className={styles.roiBreakdownVal} style={{ color: "#16a34a" }}>−{savedHours}h</span>
            <span className={styles.roiBreakdownLabel}>Horas ahorradas (65%)</span>
          </div>
          <div className={styles.roiBreakdownItem}>
            <span className={styles.roiBreakdownVal}>${PLAN_COST_USD}</span>
            <span className={styles.roiBreakdownLabel}>Costo ContaFlow</span>
          </div>
          <div className={styles.roiBreakdownItem}>
            <span className={styles.roiBreakdownVal} style={{ color: breakEven ? "#16a34a" : "#dc2626" }}>
              {breakEven ? "+" : ""}${fmt(netRoi)}
            </span>
            <span className={styles.roiBreakdownLabel}>ROI neto / mes</span>
          </div>
        </div>

        <p className={styles.roiNote}>
          Estimado con base en $10 USD/hora y reducción del 65% en tiempo administrativo
          (facturación, conciliación, nómina). Resultados individuales pueden variar.
        </p>
      </div>
    </section>
  );
}
