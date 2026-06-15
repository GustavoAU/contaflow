/**
 * nav-items.ts — Fase 28B + Permisos Granulares
 *
 * Fuente de verdad de la navegación por rol.
 * No importa de Prisma — el rol llega como string desde el server component.
 *
 * Arquitectura de 4 grupos (Sección 8 UX audit):
 *   Primary (Inicio)   → Dashboard [+ Analítica para Owner/Admin]
 *   Fiscal / SENIAT    → Libros IVA, Escanear, Importar, Retenciones, Decl. IVA, Cierre, Períodos, INPC
 *   Contabilidad       → Asientos, Plan de Cuentas, Conciliación, Activos, Reportes, Exportar
 *   Operaciones        → Pagos, Caja Chica, Distribución, Compras, Inventario, Nómina, Clientes, Proveedores, IA
 *
 * Roles → secciones:
 *   OWNER / ADMIN    → todo
 *   ACCOUNTANT       → módulos contables + reportes (sin Analítica avanzada)
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
  Calendar,
  Building2,
  ArchiveIcon,
  PackageIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  Truck,
  UserCheck,
  SparklesIcon,
  Share2,
  PiggyBank,
  FolderOpenIcon,
  WalletCardsIcon,
  BriefcaseIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type UserRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "ADMINISTRATIVE" | "VIEWER" | "SENIAT";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** true = muestra badge "Próximamente" y deshabilita el link */
  comingSoon?: boolean;
  /** true = módulo disponible en EMPRESA/DESPACHO, bloqueado en SOLO (ADR-033) */
  locked?: boolean;
};

export type NavSection = {
  /** Etiqueta del grupo — visible como separador en el sidebar */
  group: string;
  items: NavItem[];
};

export type NavConfig = {
  /** Items siempre visibles sin cabecera de sección (el "Inicio" implícito) */
  primary: NavItem[];
  /** Items agrupados con cabecera colapsable */
  sections: NavSection[];
};

// ─── Definición centralizada de ítems ────────────────────────────────────────

const item = (label: string, path: string, icon: LucideIcon, comingSoon?: boolean): NavItem => ({
  label,
  href: path,
  icon,
  comingSoon,
});

// ─── Owner / Admin (acceso completo) ─────────────────────────────────────────

function buildOwnerAdminNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard",  p(""),           LayoutDashboard),
      item("Analítica",  p("/analytics"), LineChart),
    ],
    sections: [
      {
        group: "Fiscal / SENIAT",
        items: [
          item("Libros IVA",       p("/invoices"),         ReceiptText),
          item("Escanear",         p("/invoices/upload"),  ScanIcon),
          item("Importar",         p("/import"),           FileSpreadsheetIcon),
          item("Retenciones",      p("/retentions"),       ReceiptIcon),
          item("Declaración IVA",  p("/iva-declaration"),  ScrollText),
          item("Cierre Fiscal",    p("/fiscal-close"),     CalendarCheck),
          item("Períodos",         p("/periods"),          Calendar),
          item("Inflación INPC",   p("/inflation"),        TrendingUpIcon),
        ],
      },
      {
        group: "Contabilidad",
        items: [
          item("Asientos",         p("/transactions"),          FileText),
          item("Plan de Cuentas",  p("/accounts"),              BookOpen),
          item("Conciliación",     p("/bank-reconciliation"),   LandmarkIcon),
          item("Activos Fijos",    p("/fixed-assets"),          Building2),
          item("Documentos",       p("/documents"),             FolderOpenIcon),
          item("Presupuestos",     p("/budgets"),               WalletCardsIcon),
          item("Reportes",         p("/reports"),               BarChart3),
          item("Exportar Datos",   p("/export"),                ArchiveIcon),
        ],
      },
      {
        group: "Operaciones",
        items: [
          item("Pagos",                 p("/payments"),             WalletIcon),
          item("Caja Chica",            p("/cajachica"),            PiggyBank),
          item("Distribución Ingresos", p("/income-distribution"),  Share2),
          item("Compras y Ventas",      p("/orders"),               ShoppingCartIcon),
          item("Inventario",            p("/inventory"),            PackageIcon),
          item("Nómina",                p("/payroll"),              UsersIcon),
          item("Proveedores",           p("/vendors"),              Truck),
          item("Clientes",              p("/customers"),            UserCheck),
          item("Asistente IA",          p("/ai-assistant"),         SparklesIcon),
        ],
      },
    ],
  };
}

// ─── Contador (módulos contables + reportes) ──────────────────────────────────

function buildAccountantNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
    ],
    sections: [
      {
        group: "Fiscal / SENIAT",
        items: [
          item("Libros IVA",       p("/invoices"),         ReceiptText),
          item("Escanear",         p("/invoices/upload"),  ScanIcon),
          item("Retenciones",      p("/retentions"),       ReceiptIcon),
          item("Declaración IVA",  p("/iva-declaration"),  ScrollText),
          item("Cierre Fiscal",    p("/fiscal-close"),     CalendarCheck),
          item("Períodos",         p("/periods"),          Calendar),
          item("Inflación INPC",   p("/inflation"),        TrendingUpIcon),
        ],
      },
      {
        group: "Contabilidad",
        items: [
          item("Asientos",         p("/transactions"),         FileText),
          item("Plan de Cuentas",  p("/accounts"),             BookOpen),
          item("Conciliación",     p("/bank-reconciliation"),  LandmarkIcon),
          item("Activos Fijos",    p("/fixed-assets"),         Building2),
          item("Documentos",       p("/documents"),            FolderOpenIcon),
          item("Presupuestos",     p("/budgets"),              WalletCardsIcon),
          item("Reportes",         p("/reports"),              BarChart3),
          item("Exportar Datos",   p("/export"),               ArchiveIcon),
        ],
      },
      {
        group: "Operaciones",
        items: [
          item("Pagos",                 p("/payments"),             WalletIcon),
          item("Caja Chica",            p("/cajachica"),            PiggyBank),
          item("Distribución Ingresos", p("/income-distribution"),  Share2),
          item("Compras y Ventas",      p("/orders"),               ShoppingCartIcon),
          item("Inventario",            p("/inventory"),            PackageIcon),
          item("Nómina",                p("/payroll"),              UsersIcon),
          item("Proveedores",           p("/vendors"),              Truck),
          item("Clientes",              p("/customers"),            UserCheck),
          item("Asistente IA",          p("/ai-assistant"),         SparklesIcon),
        ],
      },
    ],
  };
}

// ─── Administrativo (operaciones + grants opcionales) ─────────────────────────

function buildAdministrativeNav(companyId: string, grants: Set<string>): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  const hasGrant = (module: string) => grants.has(`ADMINISTRATIVE:${module}`);

  const sections: NavSection[] = [
    {
      group: "Fiscal",
      items: [
        item("Facturas",  p("/invoices"),        ReceiptText),
        item("Escanear",  p("/invoices/upload"), ScanIcon),
      ],
    },
    {
      group: "Operaciones",
      items: [
        item("Pagos",             p("/payments"),             WalletIcon),
        item("Conciliación",      p("/bank-reconciliation"),  LandmarkIcon),
        item("Compras y Ventas",  p("/orders"),               ShoppingCartIcon),
        item("Inventario",        p("/inventory"),            PackageIcon),
        item("Nómina",            p("/payroll"),              UsersIcon),
        item("Proveedores",       p("/vendors"),              Truck),
        item("Clientes",          p("/customers"),            UserCheck),
      ],
    },
  ];

  // Grant: accounting → accede a módulos contables
  if (hasGrant("accounting")) {
    sections.push({
      group: "Contabilidad",
      items: [
        item("Asientos",        p("/transactions"),  FileText),
        item("Plan de Cuentas", p("/accounts"),      BookOpen),
        item("Activos Fijos",   p("/fixed-assets"),  Building2),
        item("Inflación INPC",  p("/inflation"),     TrendingUpIcon),
        item("Cierre Fiscal",   p("/fiscal-close"),  CalendarCheck),
        item("Períodos",        p("/periods"),       Calendar),
      ],
    });
  }

  // Grant: reports → accede a reportes
  if (hasGrant("reports")) {
    sections.push({
      group: "Reportes",
      items: [
        item("Declaración IVA",  p("/iva-declaration"),  ScrollText),
        item("Reportes",         p("/reports"),          BarChart3),
        item("Exportar Datos",   p("/export"),           ArchiveIcon),
      ],
    });
  }

  return {
    primary: [
      item("Dashboard", p(""), LayoutDashboard),
    ],
    sections,
  };
}

// ─── Gerente / Propietario (vista simplificada sin contabilidad) ──────────────
//
// Solo ítems operativos y financieros — sin asientos, plan de cuentas, libros
// IVA, retenciones, etc. El objetivo es que el dueño de empresa vea lo que le
// importa sin la complejidad del módulo contable.
// El usuario puede volver a "Modo Sistema" en cualquier momento desde el sidebar.

function buildGerenteNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Dashboard",  p(""),           LayoutDashboard),
      item("Analítica",  p("/analytics"), LineChart),
    ],
    sections: [
      {
        group: "Mi Empresa",
        items: [
          item("Facturas",         p("/invoices"),   ReceiptText),
          item("Compras y Ventas", p("/orders"),     ShoppingCartIcon),
          item("Inventario",       p("/inventory"),  PackageIcon),
          item("Nómina",           p("/payroll"),    UsersIcon),
        ],
      },
      {
        group: "Finanzas",
        items: [
          item("Pagos",              p("/payments"),             WalletIcon),
          item("Cuentas × Cobrar",   p("/receivables"),          TrendingUpIcon),
          item("Cuentas × Pagar",    p("/payables"),             ReceiptIcon),
          item("Conciliación",       p("/bank-reconciliation"),  LandmarkIcon),
          item("Caja Chica",         p("/cajachica"),            PiggyBank),
        ],
      },
      {
        group: "Contactos",
        items: [
          item("Clientes",    p("/customers"), UserCheck),
          item("Proveedores", p("/vendors"),   Truck),
        ],
      },
    ],
  };
}

// ─── Nav auditor SENIAT (ADR-019 D-3) ────────────────────────────────────────

function buildSeniatAuditNav(companyId: string): NavConfig {
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    primary: [
      item("Libro de Ventas",   p("/audit/invoices"), ShieldCheckIcon),
      item("Registro de Caja",  p("/audit/cash"),     ReceiptIcon),
    ],
    sections: [
      {
        group: "Informes SENIAT",
        items: [
          item("Libro de Ventas",  p("/audit/invoices"), FileText),
          item("Registro de Caja", p("/audit/cash"),     ReceiptIcon),
        ],
      },
    ],
  };
}

// ─── Función pública ──────────────────────────────────────────────────────────

// Rutas que quedan bloqueadas para perfil SOLO (ADR-033)
const SOLO_LOCKED_PATHS = ["/payroll", "/inventory"];

// Agrega sección "Despacho" solo cuando scopeProfile === "DESPACHO" (ADR-034)
function applyDespachoSection(config: NavConfig, companyId: string, scopeProfile: string | null | undefined): NavConfig {
  if (scopeProfile !== "DESPACHO") return config;
  const p = (path: string) => `/company/${companyId}${path}`;
  return {
    ...config,
    sections: [
      ...config.sections,
      {
        group: "Despacho",
        items: [
          item("Clientes Despacho", p("/despacho/rifs"), BriefcaseIcon),
        ],
      },
    ],
  };
}

function applyProfileLocks(config: NavConfig, companyId: string, scopeProfile: string | null | undefined): NavConfig {
  if (scopeProfile !== "SOLO") return config;
  const lockedPaths = SOLO_LOCKED_PATHS.map((p) => `/company/${companyId}${p}`);
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        lockedPaths.includes(item.href) ? { ...item, locked: true } : item
      ),
    })),
  };
}

/**
 * Devuelve la configuración de navegación para un rol y empresa dados.
 * VIEWER recibe la misma nav que ACCOUNTANT — las restricciones de escritura
 * se aplican en los Server Actions (Fase 28C).
 *
 * @param grants        - Set de strings "ROLE:module" proveniente de RolePermission.
 *                        Solo afecta a ADMINISTRATIVE (los demás ya tienen su nav completa).
 * @param viewMode      - "gerente" activa la nav simplificada para OWNER/ADMIN.
 *                        Solo aplica a esos roles; el resto ignora el parámetro.
 * @param scopeProfile  - Perfil de alcance de la empresa (ADR-033). SOLO bloquea
 *                        Nómina e Inventario. null/undefined no aplica bloqueos.
 */
export function getNavItems(
  role: UserRole,
  companyId: string,
  grants: Set<string> = new Set(),
  viewMode: "sistema" | "gerente" = "sistema",
  scopeProfile?: string | null
): NavConfig {
  // Modo Gerencial: OWNER/ADMIN ven solo los ítems operativos y financieros.
  if (viewMode === "gerente" && (role === "OWNER" || role === "ADMIN")) {
    const gerente = applyDespachoSection(buildGerenteNav(companyId), companyId, scopeProfile);
    return applyProfileLocks(gerente, companyId, scopeProfile);
  }
  let config: NavConfig;
  switch (role) {
    case "OWNER":
    case "ADMIN":
      config = buildOwnerAdminNav(companyId);
      break;
    case "ACCOUNTANT":
      config = buildAccountantNav(companyId);
      break;
    case "ADMINISTRATIVE":
      config = buildAdministrativeNav(companyId, grants);
      break;
    case "VIEWER":
      // VIEWER ve lo mismo que ACCOUNTANT; guards en 28C bloquean escritura
      config = buildAccountantNav(companyId);
      break;
    case "SENIAT":
      // Auditor fiscal externo — solo informes de auditoría (ADR-019 D-3)
      return buildSeniatAuditNav(companyId);
    default:
      config = buildAccountantNav(companyId);
  }
  return applyProfileLocks(applyDespachoSection(config, companyId, scopeProfile), companyId, scopeProfile);
}
