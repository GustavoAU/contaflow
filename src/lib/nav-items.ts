/**
 * nav-items.ts — Fase 28B + Permisos Granulares
 *
 * Fuente de verdad de la navegación por rol.
 * No importa de Prisma — el rol llega como string desde el server component.
 *
 * Roles → secciones:
 *   OWNER / ADMIN    → todo
 *   ACCOUNTANT       → módulos contables + reportes
 *   ADMINISTRATIVE   → módulos operativos (Fase 28+); amplíable con grants
 *   VIEWER           → igual que su área, acceso restringido por guards (Fase 28C)
 *
 * getNavItems acepta un Set de grants ("ROLE:module") para añadir ítems extra
 * a ADMINISTRATIVE cuando el ADMIN le otorgó módulos adicionales.
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
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  Truck,
  UserCheck,
  SparklesIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type UserRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "ADMINISTRATIVE" | "VIEWER" | "SENIAT";

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
          item("Inventario", p("/inventory"), PackageIcon),
          item("Compras y Ventas", p("/orders"), ShoppingCartIcon),
          item("Nómina", p("/payroll"), UsersIcon),
          item("Proveedores", p("/vendors"), Truck),
          item("Clientes", p("/customers"), UserCheck),
        ],
      },
      {
        group: "IA",
        items: [
          item("Asistente IA", p("/ai-assistant"), SparklesIcon),
        ],
      },
      {
        group: "Administración",
        items: [
          item("Configuración", p("/settings"), Settings),
          item("Auditoría", p("/audit-log"), ShieldCheckIcon),
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
          item("Activos Fijos", p("/fixed-assets"), Building2),
          item("Inflación INPC", p("/inflation"), TrendingUpIcon),
          item("Conciliación", p("/bank-reconciliation"), LandmarkIcon),
          item("Cierre Fiscal", p("/fiscal-close"), CalendarCheck),
        ],
      },
      {
        group: "Inventario y Compras",
        items: [
          item("Inventario", p("/inventory"), PackageIcon),
          item("Compras y Ventas", p("/orders"), ShoppingCartIcon),
          item("Nómina", p("/payroll"), UsersIcon),
          item("Proveedores", p("/vendors"), Truck),
          item("Clientes", p("/customers"), UserCheck),
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
      {
        group: "IA",
        items: [
          item("Asistente IA", p("/ai-assistant"), SparklesIcon),
        ],
      },
    ],
  };
}

function buildAdministrativeNav(companyId: string, grants: Set<string>): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  const hasGrant = (module: string) => grants.has(`ADMINISTRATIVE:${module}`);

  const sections: NavSection[] = [
    {
      group: "Operaciones",
      items: [
        item("Escanear", p("/invoices/upload"), ScanIcon),
        item("Conciliación", p("/bank-reconciliation"), LandmarkIcon),
      ],
    },
    {
      group: "Inventario y Compras",
      items: [
        item("Inventario", p("/inventory"), PackageIcon),
        item("Compras y Ventas", p("/orders"), ShoppingCartIcon),
        item("Nómina", p("/payroll"), UsersIcon),
        item("Proveedores", p("/vendors"), Truck),
        item("Clientes", p("/customers"), UserCheck),
      ],
    },
  ];

  // Grant: accounting → accede a Contabilidad
  if (hasGrant("accounting")) {
    sections.push({
      group: "Contabilidad",
      items: [
        item("Asientos", p("/transactions"), FileText),
        item("Plan de Cuentas", p("/accounts"), BookOpen),
        item("Activos Fijos", p("/fixed-assets"), Building2),
        item("Inflación INPC", p("/inflation"), TrendingUpIcon),
        item("Cierre Fiscal", p("/fiscal-close"), CalendarCheck),
      ],
    });
  }

  // Grant: reports → accede a Reportes
  if (hasGrant("reports")) {
    sections.push({
      group: "Reportes",
      items: [
        item("Declaración IVA", p("/iva-declaration"), ScrollText),
        item("Reportes", p("/reports"), BarChart3),
        item("Exportar Datos", p("/export"), ArchiveIcon),
      ],
    });
  }

  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
      item("Facturas", p("/invoices"), ReceiptText),
      item("Pagos", p("/payments"), WalletIcon),
    ],
    sections,
  };
}

// ─── Nav auditor SENIAT (ADR-019 D-3) ────────────────────────────────────────

function buildSeniatAuditNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Libro de Ventas", p("/audit/invoices"), ShieldCheckIcon),
      item("Registro de Caja", p("/audit/cash"), ReceiptIcon),
    ],
    sections: [
      {
        group: "Informes SENIAT",
        items: [
          item("Libro de Ventas", p("/audit/invoices"), FileText),
          item("Registro de Caja", p("/audit/cash"), ReceiptIcon),
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
 *
 * @param grants - Set de strings "ROLE:module" proveniente de RolePermission.
 *                 Solo afecta a ADMINISTRATIVE (los demás ya tienen su nav completa).
 */
export function getNavItems(role: UserRole, companyId: string, grants: Set<string> = new Set()): NavConfig {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return buildOwnerAdminNav(companyId);
    case "ACCOUNTANT":
      return buildAccountantNav(companyId);
    case "ADMINISTRATIVE":
      return buildAdministrativeNav(companyId, grants);
    case "VIEWER":
      // VIEWER ve lo mismo que ACCOUNTANT; guards en 28C bloquean escritura
      return buildAccountantNav(companyId);
    case "SENIAT":
      // Auditor fiscal externo — solo informes de auditoría (ADR-019 D-3)
      return buildSeniatAuditNav(companyId);
    default:
      return buildAccountantNav(companyId);
  }
}
