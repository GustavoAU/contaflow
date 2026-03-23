# ADN MAESTRO — CONTAFLOW
_Pegar al inicio de CUALQUIER chat de ContaFlow. Es la base común._

---

## Quién soy
Ingeniero Electrónico / Senior Frontend Developer.
Stack principal: React (hooks avanzados, context, patterns), TypeScript estricto, Tailwind CSS.

## El Proyecto
**ContaFlow** — App contable SaaS multiempresa, mercado Venezuela/Latinoamérica.
Competencia directa: Gálac, CG1. Objetivo: venderlo cuando esté robusto.
Repositorio: https://github.com/GustavoAU/modern-cg1

## Stack Exacto
| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js App Router | 16 |
| ORM | Prisma | 7.4.1 |
| DB | PostgreSQL (Neon serverless) | — |
| Auth | Clerk | — |
| Validación | Zod | 4 |
| Dinero | Decimal.js | — |
| Tests | Vitest | 4 |
| Estilos | Tailwind CSS | — |
| i18n | next-intl (es/en) | — |
| OCR | Tesseract.js + Groq llama-3.1-8b-instant | — |
| CI/CD | GitHub Actions | — |

## Reglas de Oro (No Negociables)
1. **Cero fluff** — respuestas técnicas, directas, con el "por qué".
2. **SOLID + KISS** — tipado estricto, sin over-engineering.
3. **Nunca float para dinero** — siempre `Decimal.js`. Almacenar `@db.Decimal(19,4)`.
4. **`prisma.$transaction` obligatorio** en toda mutación financiera. Isolation level explícito para correlativos.
5. **Rigor fiscal SENIAT** — Prov. 0071, Dec. 1808, Ley IGTF. Si el usuario da info fiscal incorrecta, corregir con base legal.
6. **Una instrucción a la vez** — no avanzar si hay errores TS o tests fallidos.
7. **Confirmar ruta de archivo** antes de escribir código.
8. **Tests con Vitest** — nunca Jest. `// @vitest-environment jsdom` en primera línea para tests de componentes.
9. **Nombres en inglés** (archivos, vars, funciones). Contenido UI en español.
10. **AuditLog obligatorio** en toda mutation — quién, cuándo, qué cambió.
11. **`.safeParse()` obligatorio** en todas las Server Actions.
12. **Nunca exponer errores Prisma crudos** al frontend — mapear a mensajes de negocio.
13. **Inmutabilidad contable** — nunca DELETE en asientos, siempre VOID.
14. **Auth verificada ANTES** de cualquier lógica de negocio en Server Actions.

## Gotchas Críticos del Stack
- Zod 4: usar `{ error: "mensaje" }` — NO `{ message: "..." }` ni `{ errorMap: ... }`
- `vi.hoisted()` para mocks con variables antes de `vi.mock()`
- `as never` en `mockResolvedValue` para evitar errores TS en tests
- `environmentMatchGlobs` NO existe en Vitest 4 — usar `// @vitest-environment jsdom`
- `prisma.iGTFTransaction` — así genera Prisma el modelo IGTFTransaction
- Siempre reiniciar `npm run dev` después de `prisma generate`
- Error "Cannot read properties of undefined" en Prisma = cliente cacheado = reiniciar
- `onDelete: Restrict` en JournalEntry — nunca Cascade en tablas contables
- Errores Prisma P2002 = unique constraint, P2003 = foreign key

## Flujo Estándar de Fase
1. `git checkout -b feat/nombre`
2. Modificar `prisma/schema.prisma` si aplica
3. `npx prisma migrate dev --name descripcion`
4. `npx prisma generate` + reiniciar TS Server + reiniciar `npm run dev`
5. Schema Zod → Service → tests Service → Actions → tests Actions → UI → prueba browser
6. `npx vitest run` final verde → commit + push + merge

## Flujo de Trabajo entre Chats
- **Chat ARCH**: Decide estructura, schema, contratos de tipos, compliance fiscal.
- **Chat IMPL**: Recibe contrato cerrado → implementa subtarea completa (service + action + UI + tests).
- Archivo de sincronización: `contaflow-contract.md` en el repo.
- Regla: si IMPL necesita cambio de schema, vuelve a ARCH primero.
