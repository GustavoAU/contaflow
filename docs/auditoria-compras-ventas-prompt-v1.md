# Prompt — Auditoría Compras y Ventas · ContaFlow (v1 — SUPERSEDIDO)

> ⛔ **NO USAR ESTA VERSIÓN.** El monolito v1 agotó el contexto de la sesión de Claude
> Browser (1,4M tokens > máximo 1M) por acumular capturas en cada paso, y la auditoría
> quedó incompleta (Fases 3-4 bloqueadas).
>
> **Usar la v2, dividida en 4 sesiones independientes** con presupuesto de acciones y actas
> de traspaso entre partes (la Parte 2 original E-1..E-20 también desbordó el contexto —
> el browser agrega un snapshot por acción — y se subdividió en 2A/2B):
>
> 1. `auditoria-compras-ventas-prompt-v2-parte1.md` — Fases 0-2 (flujos felices + verificación
>    de fixes H-1/H-2 y fechas acotadas) — ✅ YA CORRIDA 2026-07-14, acta embebida en la 2A
> 2. `auditoria-compras-ventas-prompt-v2-parte2.md` — PARTE 2A: máquina de estados + efecto
>    fiscal (E-1, E-7, E-10..E-16; E-2..E-6/E-8/E-9 heredadas del ciclo v1, no se re-corren)
> 3. `auditoria-compras-ventas-prompt-v2-parte2b.md` — PARTE 2B: seguridad/roles (E-17..E-20)
> 4. `auditoria-compras-ventas-prompt-v2-parte3.md` — Fases 4-5 (integración + informe final)
>
> Flujo: correr cada parte en una conversación nueva → copiar su ACTA final → pegarla al
> inicio de la siguiente. La Parte 3 consolida el informe completo.
>
> El contenido íntegro del v1 está en el historial de git de este archivo.
