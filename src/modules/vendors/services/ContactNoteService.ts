// src/modules/vendors/services/ContactNoteService.ts
// Q3-2: Historial de interacciones (notas) por cliente o proveedor.
// ADR-004: companyId guard en todos los queries.

import prisma from "@/lib/prisma";

export type ContactNoteRow = {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  content: string;
  createdAt: Date;
  createdBy: string;
};

export type ContactEntityType = "CUSTOMER" | "VENDOR";

export const ContactNoteService = {
  /**
   * Lista las notas de un cliente o proveedor, ordenadas por fecha desc.
   */
  async list(
    companyId: string,
    entityType: ContactEntityType,
    entityId: string,
  ): Promise<ContactNoteRow[]> {
    return prisma.contactNote.findMany({
      where: { companyId, entityType, entityId }, // ADR-004
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },

  /**
   * Crea una nota de interacción.
   */
  async create(
    companyId: string,
    entityType: ContactEntityType,
    entityId: string,
    content: string,
    createdBy: string,
  ): Promise<ContactNoteRow> {
    return prisma.contactNote.create({
      data: { companyId, entityType, entityId, content, createdBy },
    });
  },

  /**
   * Elimina una nota (solo el autor o ADMIN).
   * Retorna false si no existe o no pertenece a la empresa.
   */
  async delete(companyId: string, noteId: string): Promise<boolean> {
    const note = await prisma.contactNote.findUnique({ where: { id: noteId } });
    if (!note || note.companyId !== companyId) return false;
    await prisma.contactNote.delete({ where: { id: noteId } });
    return true;
  },
};
