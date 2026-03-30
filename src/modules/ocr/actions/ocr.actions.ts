// src/modules/ocr/actions/ocr.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { ExtractedInvoiceSchema, type ExtractedInvoice } from "../schemas/invoice.schema";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACTION_PROMPT = `
Eres un experto en contabilidad venezolana. 
Se te dará texto extraído de una factura venezolana mediante OCR.
Tu tarea es extraer los datos contables y devolverlos ÚNICAMENTE como JSON válido.

Devuelve SOLO este objeto JSON (omite campos que no encuentres):
{
  "supplierName": "nombre del proveedor o emisor",
  "supplierRif": "RIF formato J-XXXXXXXX-X o V-XXXXXXXX o G-XXXXXXXX o E-XXXXXXXX",
  "invoiceNumber": "número de factura o número de control",
  "invoiceDate": "fecha en formato YYYY-MM-DD",
  "subtotal": "monto antes de impuestos como string numérico estándar",
  "taxAmount": "monto del IVA (16%) como string numérico estándar",
  "totalAmount": "monto total como string numérico estándar",
  "currency": "VES, USD o EUR",
  "paymentMethod": "uno de: EFECTIVO, TARJETA, PAGO_MOVIL, ZELLE, CASHEA, TRANSFERENCIA, OTRO",
  "items": [
    {
      "description": "descripción del producto o servicio",
      "quantity": "cantidad como string",
      "unitPrice": "precio unitario como string numérico estándar",
      "totalPrice": "precio total de la línea como string numérico estándar"
    }
  ],
  "notes": "texto literal de notas o comentarios de la factura, NO inventar"
}

REGLAS CRÍTICAS:
- Devuelve SOLO el JSON, sin texto adicional, sin markdown, sin backticks
- FORMATO DE MONTOS VENEZOLANO: En Venezuela se usa punto como separador de miles y coma como decimal. Ejemplo: 1.234.567,89 equivale a 1234567.89. Convierte SIEMPRE al formato numérico estándar con punto decimal
- EJEMPLOS DE CONVERSIÓN: 840.696,00 → 840696.00 | 134.511,36 → 134511.36 | 975.207,36 → 975207.36
- RIF: Siempre tiene letra al inicio (J, V, G, E) seguida de guión y números. Ejemplo: J-40137367-4. Si el OCR omitió la letra, búscala en el contexto
- FECHA: Convierte siempre a formato YYYY-MM-DD. Ejemplo: 22/04/2019 → 2019-04-22
- NOTAS: Solo incluye texto que aparezca explícitamente en la factura como nota o comentario. NO inventes ni parafrasees
- Si un campo no está claro, omítelo en vez de inventarlo
- NOTAS: SOLO incluye texto que empiece con "Nota:" o "Observación:" en la factura. Si no hay una nota explícita, omite este campo completamente
`;

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function extractInvoiceAction(
  extractedText: string
): Promise<ActionResult<ExtractedInvoice>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.ocr);
    if (!rl.allowed) return { success: false, error: rl.error };

    if (!process.env.GROQ_API_KEY) {
      return { success: false, error: "GROQ_API_KEY no configurada" };
    }

    if (!extractedText || extractedText.trim().length < 10) {
      return { success: false, error: "No se pudo extraer texto de la imagen" };
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: `Texto extraído de la factura:\n\n${extractedText}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const clean = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(clean);
    const data = ExtractedInvoiceSchema.parse(parsed);
    return { success: true, data };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { success: false, error: "No se pudo interpretar la respuesta" };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al procesar la factura" };
  }
}
