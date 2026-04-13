Read in order:
CLAUDE.md
contaflow-context-v3.md
C:\Users\Gustavo\.claude\projects\d--Documents-Projects-React-modern-cg1\memory\MEMORY.md

Then run: git status --short && npx vitest run 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | tail -5

Then analyze and report WITHOUT waiting to be asked:

## Estado actual

- Rama activa y qué fase está en curso (si hay alguna)
- Tests: ¿GREEN o hay fallos? Cantidad exacta
- TS errors: 0 o listado
- ¿Hay cambios sin commitear relevantes?

## Fases completadas recientemente

- Listar las últimas 3 fases ✅ con fecha y commit hash
- Resumen de qué entregó cada una (1 línea)

## Deuda técnica pendiente

- Findings de lessons-learned.md sin fix
- Migrations manuales pendientes de aplicar en Neon (DATABASE_URL_DIRECT)
- Cualquier TODO/FIXME crítico en el código
- Tests faltantes para código implementado sin cobertura

## UI sin implementar

- ¿Hay services/actions implementados sin UI correspondiente?
- Listar con módulo y ruta sugerida

## Próximo paso recomendado

Evaluar en este orden de prioridad:
1. ¿Hay fase en curso sin terminar? → terminarla
2. ¿Hay deuda técnica bloqueante? → resolverla primero
3. Siguiente fase del roadmap según contaflow-context-v3.md (sección Fases Planificadas)
   - Considerar checklist pre-lanzamiento (memory/project_prelaunch_checklist.md)
   - Respetar YAGNI: no implementar fases marcadas como futuras hasta que haya demanda real
4. Proponer plan concreto con archivos a crear/modificar

## Riesgos de producción

- ¿Algo sin cobertura de tests suficiente?
- ¿Migrations pendientes de aplicar?
- ¿Cambios de rol/schema que requieran acción manual en Neon?

Propone el plan concreto y espera confirmación antes de ejecutar.
