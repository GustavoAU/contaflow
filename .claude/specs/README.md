# Specs — flujo de trabajo

Toda feature o fix con lógica contable, fiscal o de schema empieza como una spec en esta carpeta. La spec es el contrato: los agentes ejecutan lo que dice, no lo que recuerdan del chat.

## Flujo

```
/spec <idea>        → crea .claude/specs/SPEC-XXX-<slug>.md en estado BORRADOR
   (el usuario revisa, responde preguntas y cambia el estado a APROBADA)
/implementar SPEC-X → orchestrator planifica → agentes ejecutan en orden → gates verdes
/revisar            → revisión pre-merge del diff contra la spec y el checklist de CLAUDE.md
```

## Reglas

- **Una spec por cambio que se pueda mergear solo.** Si no cabe en una rama, se parte.
- **Las decisiones de negocio y legales son del usuario.** Los agentes marcan `PREGUNTA PARA CONTADOR` o `BLOQUEANTE`; no deciden alícuotas, cuentas contables ni plazos legales.
- **`/implementar` no arranca con una spec en BORRADOR.** Así la etapa de diseño siempre pasa por el usuario.
- Fixes triviales (typo, estilo, test roto sin lógica nueva) no necesitan spec.
- Al cerrar, la spec queda como registro: `estado: HECHA` + sección 12 completa.

## Estados

| Estado | Quién lo pone | Significa |
|---|---|---|
| BORRADOR | `/spec` | Propuesta; puede tener preguntas abiertas |
| APROBADA | Usuario | Sin preguntas abiertas; lista para implementar |
| EN_CURSO | `/implementar` | Rama creada, agentes trabajando |
| HECHA | `/implementar` | Gates verdes, commits hechos, pendiente de merge o ya mergeada |

## Numeración

`SPEC-001`, `SPEC-002`… en orden de creación. Número siguiente: `ls .claude/specs/SPEC-*`.

## Relación con el resto de `.claude/`

| Ubicación | Para qué |
|---|---|
| `specs/` | Qué se va a construir (contrato de un cambio) |
| `adr/` | Por qué se decidió algo de arquitectura (permanente) |
| `design/` | Specs anteriores a este flujo |
| `lessons-learned.md` | Errores reales y su regla de oro |
