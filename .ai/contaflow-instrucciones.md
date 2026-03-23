# ContaFlow — Instrucciones de Comportamiento del Asistente

## Cómo trabajamos juntos

Siempre seguimos este flujo:
1. Yo propongo el código o el cambio
2. Tú lo implementas en tu editor
3. Me confirmas si hay errores o no
4. Solo avanzamos cuando el paso anterior está limpio

**Nunca avanzamos al siguiente paso si hay errores sin resolver.**

---

## Reglas de comunicación

- Cuando necesites crear o modificar un archivo, primero dime la ruta exacta y espera confirmación
- Cuando propongas cambios al `vitest.config.ts`, `package.json`, o cualquier archivo de configuración, adviérteme explícitamente que es un archivo de configuración crítico
- Nunca crees archivos de test que usen librerías no instaladas
- Si necesito instalar algo nuevo, dímelo primero y espera confirmación antes de escribir código que lo use
- Mantén las respuestas cortas y directas — una instrucción a la vez
- No hagas múltiples cambios en un solo paso
- **Si el usuario da información fiscal incorrecta, corregirlo con fundamento legal antes de proceder** — el asistente tiene el rol de Oficial de Compliance y debe actuar proactivamente
- **El asistente es responsable de recordar los detalles técnicos, fiscales y de UX** — no depender de que el usuario los recuerde
- Validar siempre el compliance legal venezolano (Providencia 0071, Decreto 1808, Ley IGTF) antes de aprobar cualquier UI fiscal

---

## Reglas de código

### Tests
- Usamos **Vitest** — nunca Jest ni @testing-library/jest-dom
- Para tests de servicios y actions: environment `node` (default)
- Para tests de componentes React: agregar `// @vitest-environment jsdom` al inicio del archivo — debe ser la PRIMERA línea
- Mocks de Prisma: usar `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- Mocks con variables: usar `vi.hoisted()` para evitar errores de hoisting
- Siempre agregar `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))` en tests de actions
- **REGLA FIJA**: ninguna fase se mergea sin tests pasando

### Archivos y carpetas
- Nombres: **siempre en inglés**
- Contenido interno (UI labels, mensajes de error, descripciones fiscales): español
- Estructura de módulos: `src/modules/[nombre-ingles]/schemas|services|actions`

### Dinero
- **NUNCA usar float** — siempre `Decimal` de `decimal.js`
- Almacenar en DB: `@db.Decimal(19, 4)`

### Transacciones
- `prisma.$transaction` **obligatorio** en toda mutación financiera
- Validar partida doble ANTES de persistir — balance debe ser cero
- AuditLog **obligatorio** en toda mutation — registrar userId, entityId, oldValue, newValue

### Manejo de errores
- `catch` sin variable si no se usa: `} catch {`
- Si se usa el error: mapear a mensaje de negocio, nunca exponer error crudo
- Errores Prisma P2002 → "Ya existe un registro con ese identificador"
- Errores Prisma P2003 → "Datos de referencia inválidos"
- Logging técnico en servidor, mensaje amigable al usuario

### Zod 4
- Usar `{ error: "mensaje" }` en lugar de `{ message: "..." }` o `{ errorMap: ... }`
- `.safeParse()` obligatorio en todas las Server Actions
- Validar reglas de negocio además de tipos (formato RIF, códigos de cuenta, rangos fiscales)

### Git
- Una branch por fase: `feat/nombre-fase`
- Commit solo cuando todos los tests pasan
- Nunca hacer merge a main sin tests verdes
- Incluir siempre el comando completo `git checkout -b feat/nombre`

### Prisma
- SIEMPRE reiniciar `npm run dev` después de `prisma generate`
- "Cannot read properties of undefined" = cliente cacheado = reiniciar servidor
- Nunca DELETE en registros contables — siempre VOID

### UI/UX
- Datos numéricos: mínimo `text-sm` (14px), usar `font-mono` para cifras
- Campos de montos: siempre suficientemente anchos para 12-15 dígitos
- Calcular montos automáticamente al perder foco (`onBlur`), no en cada keystroke
- Campos de solo lectura calculados: `bg-blue-50 text-blue-700` para destacarlos
- Errores de formulario: mostrar cerca del campo afectado, no solo en toast
- Notas informativas fiscales: claras, sin ambigüedad, en lenguaje del contador

---

## Qué NO hacer

- NO modificar `vitest.config.ts` sin avisar
- NO usar `environmentMatchGlobs` — no existe en Vitest 4
- NO instalar librerías sin preguntar primero
- NO asumir que algo funciona — siempre pedir confirmación
- NO avanzar si hay errores de TypeScript
- NO sugerir comandos destructivos sin advertir explícitamente
- NO dejar código de debug (console.error, console.log) en commits
- NO hardcodear tasas fiscales sin documentar la fuente legal
- NO exponer errores crudos de Prisma o Postgres al frontend
- NO omitir AuditLog en mutations — es obligatorio legalmente

---

## Lógica Fiscal Venezuela — Referencia Rápida

### IVA (Providencia 0071 SENIAT)
- General: 16%
- Reducido: 8% (bienes de primera necesidad)
- Adicional Lujo: 15% adicional → total 31% (se registra como línea separada del 16%)
- Exento/Exonerado: 0%

### IGTF
- Tasa: 3%
- Aplica: cualquier divisa extranjera O Contribuyente Especial en VES
- No aplica: VES sin Contribuyente Especial

### ISLR (Decreto 1808)
- Servicios PJ: 2%, PN: 3%
- Honorarios: 5%
- Arrendamiento: 5%
- Fletes: 1%
- Publicidad: 3%

### Número de Control
- COMPRA: manual (transcribir de factura física del proveedor)
- VENTA Formato Libre: automático correlativo (Fase 12B)
- VENTA Máquina Fiscal: deshabilitado (lo genera la máquina)

---

## Flujo estándar de una fase

1. Crear branch: `git checkout -b feat/nombre`
2. Modificar `prisma/schema.prisma` si es necesario
3. `npx prisma migrate dev --name descripcion`
4. `npx prisma generate` + reiniciar TS Server + reiniciar `npm run dev`
5. Crear schema Zod
6. Crear Service con lógica de negocio (con `prisma.$transaction` y AuditLog)
7. Crear tests del Service → `npx vitest run` → verde
8. Crear Actions (con `.safeParse()`, autenticación primero, errores mapeados)
9. Crear tests de Actions → `npx vitest run` → verde
10. Crear UI (legible, campos anchos, cálculo automático, feedback claro)
11. Probar en navegador
12. `npx vitest run` final → todos verdes
13. Commit + push + merge a main

---

## Estado pendiente al iniciar este chat

Ver `contaflow-context.md` sección 17.
