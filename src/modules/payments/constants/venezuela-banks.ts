// src/modules/payments/constants/venezuela-banks.ts
// Lista oficial de bancos venezolanos (BCV — actualizada 2026)

export const VENEZUELA_BANKS = [
  "Banco de Venezuela",
  "Banco Mercantil",
  "Banesco",
  "BBVA Provincial",
  "Banco Nacional de Crédito (BNC)",
  "Banco del Tesoro",
  "Banco Bicentenario",
  "Bancrecer",
  "Bancamiga",
  "Banco Exterior",
  "Banco Caroní",
  "Bancaribe",
  "Banco Activo",
  "Banco Fondo Común (BFC)",
  "100% Banco",
  "Mi Banco",
  "Banplus",
  "Delsur Banco Universal",
  "Banco Agrícola de Venezuela (BAV)",
  "Banco del ALBA",
  "Banco Bandes",
  "Banco de la Fuerza Armada Nacional (BANFANB)",
  "Instituto Municipal de Crédito Popular (IMCP)",
  "Otro",
] as const;

export type VenezuelaBankName = (typeof VENEZUELA_BANKS)[number];
