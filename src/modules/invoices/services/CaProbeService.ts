import { getNextControlNumber } from "./InvoiceSequenceService";

// PR DE PRUEBA DESCARTABLE (SPEC-014, CA-1): llamada a un generador de correlativo FUERA de
// una transacción Serializable. El test de arquitectura `correlativo-serializable` debe fallar.
export async function caProbe(tx: Parameters<typeof getNextControlNumber>[0]) {
  return getNextControlNumber(tx, "ca-probe", "SALE");
}

// Segundo push (CA-6): debe cancelar la corrida anterior de este PR.
