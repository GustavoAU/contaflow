// src/lib/fiscal-validators.ts
// Validadores fiscales venezolanos compartidos (VEN-NIF)

/**
 * Regex canónica para RIF venezolano.
 * Prefijos: J=Jurídica, V=Natural, E=Extranjero, G=Gobierno, C=Comunal, P=Pasaporte
 * Dígito verificador opcional (campo Prisma lo almacena completo).
 * Case-insensitive para tolerancia de entrada.
 */
export const VEN_RIF_REGEX = /^[JVEGCP]-\d{8}-?\d?$/i;

export function validateVenezuelanRif(rif: string): boolean {
  return VEN_RIF_REGEX.test(rif);
}
