# ADR-028: Código de Referencia y Grupos en Customer/Vendor

**Estado:** Aprobado ✅
**Fecha:** 2026-05-20
**Autor:** Gustavo / Claude
**Afecta:** `Customer`, `Vendor`, `CustomerGroup`, `VendorGroup`, `CustomerService`, `VendorService`

---

## Contexto

Los modelos `Customer` y `Vendor` carecen de:
1. **Código de referencia interno** (ej: C-001, C-002, P-005) para identificar rápidamente un contacto en reportes, PDFs y búsquedas sin depender del nombre completo.
2. **Agrupación** (ej: "Clientes Premium", "Proveedores Nacionales") para segmentar contactos en reportes y filtros.

---

## Decisión

### D-1: Campo `code` opcional en Customer y Vendor

- `code String?` — entrada manual del usuario, formato libre (C-001, CLI-0042, etc.)
- `@@unique([companyId, code])` — unicidad dentro de la empresa; múltiples `NULL` permitidos (PostgreSQL trata NULLs como distintos en índices únicos)
- **No se auto-genera**: evita entrar en la Zona Z-1 (correlativos Serializable). El código es informativo, no fiscal.

### D-2: Modelos `CustomerGroup` y `VendorGroup`

```prisma
model CustomerGroup {
  id        String   @id @default(cuid())
  companyId String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  company   Company    @relation(fields: [companyId], references: [id], onDelete: Restrict)
  customers Customer[]

  @@unique([companyId, name])
  @@index([companyId])
}
```

Mismo patrón para `VendorGroup`.

### D-3: Relación opcional en Customer/Vendor

- `groupId String?` con FK a `CustomerGroup`/`VendorGroup`
- `onDelete: SetNull` — borrar un grupo desvincula los contactos sin eliminarlos

---

## Alternativas rechazadas

| Alternativa | Razón |
|---|---|
| Auto-generación de correlativo | Requiere `Serializable` + manejo P2002 (Zona Z-1). El campo es informativo, no fiscal — overhead injustificado. |
| `category` enum | Limita flexibilidad. Los grupos con nombre libre son más útiles en la práctica. |
| Grupos como tags (m2m) | Mayor complejidad de schema. La mayoría de contactos pertenecen a un solo grupo. FK simple es suficiente. |
| Grupos como subcollection en Vendor/Customer | Aumenta nesting; la tabla separada permite reportes por grupo directamente. |

---

## Consecuencias

- Migración aditiva — ningún campo existente cambia, no hay breaking changes.
- `VendorRow` y `CustomerRow` se extienden con `code` y `group.name`.
- Los formularios de creación/edición añaden campo "Código" y selector "Grupo".
- Sin impacto en lógica fiscal (Z-2) ni en correlativos (Z-1).
