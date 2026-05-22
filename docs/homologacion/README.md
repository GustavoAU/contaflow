# Expediente de Homologación — ContaFlow v1.0.0
**Providencia Administrativa SNAT/2024/000121**

---

## Estado del Expediente

| # | Documento | Estado | Archivo |
|---|---|---|---|
| — | Solicitud de Homologación (expediente principal) | ✅ Preparado | `ContaFlow_Expediente_Homologacion_SENIAT_v2.docx` |
| 4 | Manual Técnico v1.0.0 | ✅ Listo | `manual-tecnico-v1.0.0.md` |
| 5 | Manual de Usuario v1.0.0 | ✅ Listo | `manual-usuario-v1.0.0.md` |
| 6 | Descripción de Arquitectura | ✅ En expediente principal | Sección VI del expediente |
| 7 | Declaración Jurada | ✅ En expediente principal | Sección VII del expediente |
| 9 | Política de Seguridad y Privacidad | ✅ Listo | `politica-seguridad-privacidad.md` |
| 10 | Diagramas de Flujo de Datos Fiscales | ✅ Listo | `diagramas-flujo-fiscal.md` |
| 1 | Cédula de Identidad (200%) | ⏳ Pendiente — documento físico | — |
| 2 | RIF del solicitante | ⏳ Pendiente — documento físico | — |
| 3 | Acta Constitutiva (si aplica) | ⏳ Pendiente — documento físico | — |
| 8 | Certificado SSL/TLS del dominio | ⏳ Bloqueado — requiere dominio | — |

---

## Pendientes antes de presentar

1. **Rellenar placeholders** en el expediente principal:
   - `[NOMBRE COMPLETO DEL SOLICITANTE]`
   - `[V-XXXXXXXX / J-XXXXXXXXX-X]`
   - `[NÚMERO DE TELÉFONO]`
   - `[CORREO ELECTRÓNICO]`
   - `[FECHA DE PRESENTACIÓN]`

2. **Actualizar número de pruebas** en expediente principal:
   - Sección 6.3 dice "1.531 pruebas" → actualizar a **1.983 pruebas**

3. **Adjuntar documentos físicos** (ítems 1, 2, 3)

4. **Obtener certificado SSL** una vez se tenga el dominio (ítem 8)

---

## Órgano Receptor

```
Intendencia Nacional de Tributos Internos — SENIAT
Gerencia Regional de Tributos Internos — Región Centro Occidental
Barquisimeto, Estado Lara, Venezuela
Portal: https://seniatenlinea.seniat.gob.ve/tributos-software-facturacion/
```

## Plazo de Respuesta SENIAT
**15 días hábiles** conforme al Artículo 6 de la PA 121.

---

## Conversión a PDF/Word

Para convertir los archivos `.md` a formato Word o PDF para el expediente físico, se recomienda:
- **Pandoc**: `pandoc manual-tecnico-v1.0.0.md -o manual-tecnico-v1.0.0.docx`
- **Typora** o **Obsidian** para conversión visual con formato
- **VS Code + Markdown PDF extension** para PDF directo
