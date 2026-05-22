-- Auditoría SENIAT: tipo de producto (NIIF para PYMES Sección 13)
-- ItemType distingue Mercancía (movimientos físicos) de Servicio (intangible, sin stock).
-- SERVICE bloquea ENTRADA/SALIDA físicas en el servicio y la UI.
CREATE TYPE "ItemType" AS ENUM ('GOODS', 'SERVICE', 'RAW_MATERIAL', 'FINISHED_GOOD');
ALTER TABLE "InventoryItem" ADD COLUMN "itemType" "ItemType" NOT NULL DEFAULT 'GOODS';
