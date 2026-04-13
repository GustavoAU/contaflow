/**
 * nav-items.ts — Fase 28B
 *
 * Fuente de verdad de la navegación por rol.
 * No importa de Prisma — el rol llega como string desde el server component.
 *
 * Roles → secciones:
 *   OWNER / ADMIN    → todo
 *   ACCOUNTANT       → módulos contables + reportes
 *   ADMINISTRATIVE   → módulos operativos (Fase 28+)
 *   VIEWER           → igual que su área, acceso restringido por guards (Fase 28C)
 */

import {
  LayoutDashboard,
  BookOpen,
  FileText,
  BarChart3,
  Settings,
  ScanIcon,
  FileSpreadsheetIcon,
  ReceiptIcon,
  BanknoteIcon,
  ReceiptText,
  TrendingUpIcon,
  WalletIcon,
  LandmarkIcon,
  LineChart,
  ScrollText,
  CalendarCheck,
  Building2,
  ArchiveIcon,
  PackageIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type UserRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "ADMINISTRATIVE" | "VIEWER";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** true = muestra badge "Próximamente" y deshabilita el link */
  comingSoon?: boolean;
};

export type NavSection = {
  /** Etiqueta del grupo — visible como separador en el dropdown "Más" */
  group: string;
  items: NavItem[];
};

export type NavConfig = {
  /** Items siempre visibles en la barra principal (máx ~4) */
  primary: NavItem[];
  /** Items en el dropdown "Más", agrupados por sección */
  sections: NavSection[];
};

// ─── Definición centralizada de ítems ────────────────────────────────────────

const item = (label: string, path: string, icon: LucideIcon, comingSoon?: boolean): NavItem => ({
  label,
  href: path,
  icon,
  comingSoon,
});

// ─── Configs por rol ──────────────────────────────────────────────────────────

function buildOwnerAdminNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
      item("Asientos", p("/transactions"), FileText),
      item("Plan de Cuentas", p("/accounts"), BookOpen),
      item("Reportes", p("/reports"), BarChart3),
    ],
    sections: [
      {
        group: "Contabilidad",
        items: [
          item("Libros IVA", p("/invoices"), ReceiptText),
          item("Retenciones", p("/retentions"), ReceiptIcon),
          item("IGTF", p("/igtf"), BanknoteIcon),
          item("Tasas BCV", p("/exchange-rates"), TrendingUpIcon),
          item("Activos Fijos", p("/fixed-assets"), Building2),
          item("Inflación INPC", p("/inflation"), TrendingUpIcon),
          item("Declaración IVA", p("/iva-declaration"), ScrollText),
          item("Cierre Fiscal", p("/fiscal-close"), CalendarCheck),
          item("Conciliación", p("/bank-reconciliation"), LandmarkIcon),
        ],
      },
      {
        group: "Operaciones",
        items: [
          item("Pagos", p("/payments"), WalletIcon),
          item("Escanear", p("/invoices/upload"), ScanIcon),
          item("Importar", p("/import"), FileSpreadsheetIcon),
          item("Analítica", p("/analytics"), LineChart),
          item("Exportar Datos", p("/export"), ArchiveIcon),
          item("Inventario", p("/inventory"), PackageIcon, true),
        ],
      },
      {
        group: "Administración",
        items: [
          item("Configuración", p("/settings"), Settings),
        ],
      },
    ],
  };
}

function buildAccountantNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
      item("Asientos", p("/transactions"), FileText),
      item("Plan de Cuentas", p("/accounts"), BookOpen),
      item("Libros IVA", p("/invoices"), ReceiptText),
    ],
    sections: [
      {
        group: "Contabilidad",
        items: [
          item("Retenciones", p("/retentions"), ReceiptIcon),
          item("IGTF", p("/igtf"), BanknoteIcon),
          item("Tasas BCV", p("/exchange-rates"), TrendingUpIcon),
          item("Activos Fijos", p("/fixed-assets"), Building2),
          item("Inflación INPC", p("/inflation"), TrendingUpIcon),
          item("Conciliación", p("/bank-reconciliation"), LandmarkIcon),
          item("Cierre Fiscal", p("/fiscal-close"), CalendarCheck),
        ],
      },
      {
        group: "Inventario",
        items: [
          item("Inventario", p("/inventory"), PackageIcon, true),
        ],
      },
      {
        group: "Reportes",
        items: [
          item("Declaración IVA", p("/iva-declaration"), ScrollText),
          item("Reportes", p("/reports"), BarChart3),
          item("Exportar Datos", p("/export"), ArchiveIcon),
        ],
      },
    ],
  };
}

function buildAdministrativeNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
      item("Facturas", p("/invoices"), ReceiptText),
      item("Pagos", p("/payments"), WalletIcon),
    ],
    sections: [
      {
        group: "Operaciones",
        items: [
          item("Escanear", p("/invoices/upload"), ScanIcon),
          item("Conciliación", p("/bank-reconciliation"), LandmarkIcon),
        ],
      },
      {
        group: "Inventario",
        items: [
          item("Inventario", p("/inventory"), PackageIcon, true),
        ],
      },
    ],
  };
}

// ─── Función pública ──────────────────────────────────────────────────────────

/**
 * Devuelve la configuración de navegación para un rol y empresa dados.
 * VIEWER recibe la misma nav que ACCOUNTANT — las restricciones de escritura
 * se aplican en los Server Actions (Fase 28C).
 */
export function getNavItems(role: UserRole, companyId: string): NavConfig {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return buildOwnerAdminNav(companyId);
    case "ACCOUNTANT":
      return buildAccountantNav(companyId);
    case "ADMINISTRATIVE":
      return buildAdministrativeNav(companyId);
    case "VIEWER":
      // VIEWER ve lo mismo que ACCOUNTANT; guards en 28C bloquean escritura
      return buildAccountantNav(companyId);
    default:
      return buildAccountantNav(companyId);
  }
}
