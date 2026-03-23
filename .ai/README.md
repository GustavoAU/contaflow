# ContaFlow — Sistema de Chats Especializados
_Cómo usar estos archivos para maximizar la precisión del asistente._

---

## Archivos en este sistema

| Archivo | Propósito | Cuándo usarlo |
|---------|-----------|---------------|
| `adn-maestro.md` | Base común de todos los chats | SIEMPRE, primer archivo a pegar |
| `instrucciones-arch.md` | Rol del Chat ARCH | Al abrir sesión de arquitectura |
| `instrucciones-impl.md` | Rol del Chat IMPL | Al abrir sesión de implementación |
| `contaflow-contract.md` | Contratos vigentes entre chats | Pegar en IMPL, actualizar tras ARCH |
| `contaflow-context-v2.md` | Estado completo del proyecto | Pegar cuando se necesita contexto total |

---

## Cómo iniciar cada tipo de sesión

### Chat ARCH (Decisiones)
```
1. Pegar: adn-maestro.md
2. Pegar: instrucciones-arch.md
3. Pegar: contaflow-contract.md
4. Decir: "Necesito cerrar el contrato de [subtarea X]"
```

### Chat IMPL (Implementación)
```
1. Pegar: adn-maestro.md
2. Pegar: instrucciones-impl.md
3. Pegar: contaflow-contract.md (con contratos cerrados por ARCH)
4. Pegar: schema.prisma actual (copiar del repo)
5. Decir: "Implementa la subtarea 18.X — [nombre]"
```

---

## Flujo para la Fase 12B

### Orden recomendado

**Semana 1 — Definir contratos en ARCH:**
1. Subtarea 18.1: Decidir formato de controlNumber y estrategia de concurrencia
2. Subtarea 18.2: Decidir librería PDF
3. Subtareas 18.4: Aprobar schema de vinculación Retencion↔Invoice
4. Decisión global: Neon adapter en PrismaClient (URGENTE)

**Semana 2 — Implementar en IMPL (en este orden):**
1. 18.6 — Validación RIF (solo Zod, sin dependencias, 30 min)
2. 18.3 — Cascada TaxCategory (solo UI, sin dependencias, 1h)
3. 18.1 — Número de Control (schema + service + action + UI, 3h)
4. 18.4 — Vinculación Retencion↔Invoice (2h)
5. 18.2 — PDF Export (depende de decisión librería, 3h)
6. 18.5 — Comprobantes PDF (depende de 18.2, 2h)

---

## Regla de sincronización

Después de cada sesión de ARCH que cierre un contrato:
1. Actualizar `contaflow-contract.md` con la sección `## [Nombre] (ARCH [fecha])`
2. Mover el contrato de "PENDIENTE" a "Contratos Cerrados ✅"
3. Guardar el archivo antes de abrir Chat IMPL

Después de cada sesión de IMPL que complete una subtarea:
1. Hacer commit con los archivos de la subtarea
2. Anotar en `contaflow-contract.md` el estado `IMPLEMENTADO ✅`

---

## Señales de alerta

🔴 **No abrir IMPL sin contrato cerrado en ARCH** para subtareas con schema o concurrencia.
🔴 **No hacer migrate en IMPL** — las migraciones las decide y nombra ARCH.
🟡 **Si IMPL pide un cambio de schema**, cerrar IMPL, ir a ARCH, cerrar el contrato, volver a IMPL.
🟡 **Si hay duda fiscal**, llevar a ARCH (o a este chat) antes de implementar.
