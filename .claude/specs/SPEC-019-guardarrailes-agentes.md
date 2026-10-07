---
id: SPEC-019
titulo: Guardarraíles de agentes — hooks, pre-commit, worktrees y protección de main
estado: BORRADOR
fecha: 2026-10-07
rama: chore/spec-019-guardarrailes-agentes
arbol: "[11]"
zonas: []
adrs: []
---

# Guardarraíles de agentes

## 1. Problema
Las reglas de trabajo de los agentes viven solo en texto (`CLAUDE.md`, `.claude/agents/*.md`, `lessons-learned.md`). No existe `.claude/settings.json`: no hay hooks ni permisos. Tampoco hay pre-commit (`.githooks/` no existe y `core.hooksPath` no está configurado). Además, **`.gitignore` ignora `.claude/settings.json`** (línea 47, junto a `settings.local.json`), así que aunque se creara, no se podría versionar.

El historial lo muestra:
- Commits directos a `main`: 64 de los últimos 215 en first-parent (un solo padre), mayormente docs.
- Dos sesiones que comparten un mismo working tree (documentado en las notas del dueño; no queda rastro en el mensaje de ningún commit, así que no se puede citar un SHA).
- Formateo, `tsc` y `verify:*` dependen de que el agente se acuerde.
- El agente puede ejecutar comandos por dos herramientas en Windows: `Bash` y `PowerShell`. Una regla que solo cubra `Bash` se evade con la otra.

`ai-sdlc` resuelve lo mismo con un `.githooks/pre-commit` sin dependencias, y con worktree más comando de aceptación por orden de trabajo.

## 2. Base legal / contable
Ninguna — decisión de ingeniería.

## 3. Alcance
**Incluye:**
- A) **`.claude/settings.json`** (versionado) y corrección de `.gitignore`: quitar la línea `.claude/settings.json`, mantener `.claude/settings.local.json` ignorado. Esquema confirmado con la documentación oficial (ver sección 11):
  - Eventos usados: `PreToolUse`, `PostToolUse`, `Stop`. Cada uno contiene una lista de `{ matcher, hooks: [{ type: "command", command, … }] }`; el comando recibe por stdin un JSON con `tool_name`, `tool_input` (`command` o `file_path`), `cwd`, `session_id`.
  - **Bloquear = salir con código 2** y escribir el motivo en stderr. Cualquier otro código distinto de 0 **no bloquea** (la acción sigue). Por eso `guard-bash.mjs` envuelve todo en `try/catch` y ante un error interno sale con 2 y un mensaje accionable (falla cerrado). Alternativa equivalente: JSON con `hookSpecificOutput.permissionDecision: "deny"`.
  - `permissions.deny`, primera capa (los patrones `Bash(...)` son por prefijo y **se evaden**: `Bash(git push *)` no atrapa `git -C . push`, `git -c k=v commit` ni `cd x && git push`; la propia documentación recomienda un hook `PreToolUse` para inspeccionar el comando completo):
    - `git push` a `main`, `git push --force` / `-f`
    - `prisma migrate reset`, `prisma db push`, `prisma db execute`
    - `Read(./.env)`, `Read(./.env.*)`
  - Hook **PreToolUse** con `matcher: "Bash|PowerShell"` → `node .claude/hooks/guard-bash.mjs`. Analiza el comando completo (divide por `&&`, `;`, `|` y subshells; descarta opciones globales de git como `-C <ruta>`, `-c k=v`, `--git-dir`, `--work-tree`) y bloquea:
    - `git commit` / `git merge` / `git rebase` / `git push` estando en `main` o con destino `main` (incluye `git push origin HEAD:main`)
    - `git add -A` / `git add .` en la raíz
    - `git checkout`/`switch` a otra rama si el árbol tiene cambios ajenos (heurística; riesgo de falsos positivos, ver R-4)
    - cualquier comando que lea `.env*` (`cat`, `type`, `Get-Content`, `grep`, `less`…), porque `permissions.deny` de `Read` no cubre la shell
    - cualquier comando con la URL o el host de producción de Neon (patrón configurable por la variable `PRODUCTION_DB_HOST` que introduce SPEC-015; si no está definida, el hook solo avisa)
  - Hook **PostToolUse** (`Edit|Write|MultiEdit`) sobre `src/**/*.{ts,tsx,json}` (el mismo alcance que `pnpm format:check`) → Prettier solo sobre el archivo tocado.
  - Hook **Stop** → `tsc --noEmit` incremental (`incremental: true` ya está en `tsconfig.json`; `*.tsbuildinfo` está ignorado). Si falla, devuelve el error al agente (`decision: "block"` o exit 2) para que no cierre el turno en rojo. **Evitar bucles:** el hook sale con 0 si su entrada trae `stop_hook_active: true` (confirmar el campo en la documentación vigente; el reporte de la fase 1 no pudo verificarlo) y, en todo caso, reintenta como máximo una vez por turno mediante una marca en el scratchpad. Medir el tiempo; si pasa de ~60 s, convertirlo en `typecheck:changed` o retirarlo y dejarlo en pre-commit.
  - **Los hooks no usan `pnpm exec`/`pnpm run`.** En la verificación de esta fase, un `pnpm exec eslint` en el checkout principal disparó una resolución/instalación de dependencias (salida `Packages: +1245`). Invocar los binarios directamente (`node node_modules/prettier/bin/prettier.cjs`, `node node_modules/typescript/bin/tsc`).
  - Windows: la shell por defecto de los hooks puede no ser `bash`. La documentación admite el campo `shell` por hook; probar `node …` con ruta relativa y, si hace falta, `"shell": "bash"` con `$CLAUDE_PROJECT_DIR` (R-3).
- B) **`.githooks/pre-commit`** (sh, sin dependencias nuevas, estilo `ai-sdlc`):
  1. Rechaza commits en `main`.
  2. Rechaza `.env`, `.env.local`, `*.local.json`.
  3. `prettier --check` sobre los archivos staged que cumplan el alcance de `format:check` (`src/**/*.{ts,tsx,json}`).
  4. Si hay staged en `prisma/schema.prisma` sin staged en `prisma/migrations/`, rechaza con un mensaje **autocontenido** (qué falta y cómo crear la migración; no remite a SPEC-015, que puede no estar aún mergeada). Un cambio de schema sin efecto en la BD (comentarios) se salta con `--no-verify`.
  5. Si hay staged en `.claude/specs/`, corre `pnpm check:specs` (SPEC-020; si aún no existe el script, el paso se salta con aviso).

  Activación: **no** con `"prepare": "git config core.hooksPath .githooks"` a secas. En el build de Vercel y en el `Dockerfile` no hay `.git`, y `git config` fallaría rompiendo la instalación. Usar `"prepare": "node scripts/setup-hooks.mjs"`, que ejecuta `git config` dentro de un `try/catch` y sale con 0 siempre. `core.hooksPath` relativo funciona en todos los worktrees porque `.githooks/` está versionado. Bypass consciente: `--no-verify`, documentado.
- C) **Worktree por sesión:** `.claude/commands/implementar.md` paso 2 crea la rama en `git worktree add .claude/worktrees/<slug> -b <rama> origin/main`, con `<slug>` = la rama con `/` sustituido por `-` (convención ya existente: `chore-claude-contexto`, `chore-claude-flujo-specs`; una ruta con `/` crearía carpetas anidadas). Todos los pasos posteriores, incluida la línea base del paso 1.5 y `git status` del paso 1.4, se ejecutan **dentro** del worktree: un árbol principal sucio deja de bloquear. El worktree necesita su propio `pnpm install`.
  - `vitest.config.ts` ya excluye `**/.claude/worktrees/**` y `**/.worktrees/**`. Hoy conviven dos carpetas de worktrees (`.claude/worktrees/` y `.worktrees/`); la canónica pasa a ser `.claude/worktrees/`. `eslint.config.mjs` debe ignorar ambas (ver SPEC-014 G).
  - Regla en `CLAUDE.md`: **una sesión, un worktree; nunca dos agentes en el mismo árbol**. `/revisar` comprueba que no está en el worktree principal.
  - Para borrar worktrees con `node_modules` en Windows, `git worktree remove` falla por rutas largas: usar `fs.rmSync` de Node fuera del directorio (nota del dueño). Documentarlo en el comando.
- D) **Comando de aceptación por spec:** el paso 4 de `/implementar` corre el comando `aceptacion:` del frontmatter de la spec (SPEC-020) además de los gates generales. Si no existe, usa los gates generales y lo avisa. **Solo se ejecutan comandos que empiecen por `pnpm `, `node ` o `npx vitest `**: una spec en BORRADOR es texto no confiable (puede venir de un revisor externo) y el comando se ejecuta con los permisos del agente.
- E) **Protección de `main` (lo hace el usuario en GitHub):** ruleset sobre `main` que exija PR, el check requerido `CI Result (all checks passed)` y bloquee force-push y borrado. La decisión sobre bypass de admin es del usuario. Los commits de docs también van por PR (pueden ser PRs pequeños con auto-merge). Esto **cambia una regla vigente**: `CLAUDE.md` (Git workflow) dice hoy "Docs pueden ir directo a `main`"; debe actualizarse en esta spec.

**No incluye (explícito):**
- Husky, lint-staged u otras dependencias nuevas.
- Reescribir los agentes de `.claude/agents/`.

## 4. Reglas de negocio
- RN-1: Ningún agente puede commitear ni pushear a `main`: lo impiden el hook de Claude Code, el pre-commit y el ruleset (tres capas).
- RN-2: Ningún agente lee archivos `.env*` con secretos, ni por `Read` ni por la shell.
- RN-3: Los hooks fallan con un mensaje accionable (qué se bloqueó y qué hacer), nunca con un exit opaco.
- RN-4: Todo hook es determinista y corre en menos de 2 s, salvo el Stop (≤ 60 s, ver A).
- RN-5: Las reglas de shell cubren `Bash` **y** `PowerShell`.
- RN-6: `prepare` nunca hace fallar `pnpm install` (Vercel, Docker, CI sin `.git`).

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
No aplica. Archivos:
- `.gitignore` (quitar `.claude/settings.json`)
- `.claude/settings.json` (nuevo)
- `.claude/hooks/guard-bash.mjs` (nuevo, con tests en `scripts/__tests__/guard-bash.test.ts`)
- `.githooks/pre-commit` (nuevo) y `scripts/setup-hooks.mjs` (nuevo)
- `package.json` (`prepare`)
- `.claude/commands/implementar.md`, `.claude/commands/revisar.md`
- `CLAUDE.md` (inicio de sesión: worktree; Git workflow: docs por PR)

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: Test unitario de `guard-bash.mjs` con una tabla de comandos permitidos y bloqueados (≥ 20 casos), incluidos `git -C . commit`, `git -c user.name=x commit`, `cd src && git push`, `git push origin HEAD:main`, `cat .env.local`, `Get-Content .env`, y los mismos comandos de git invocados desde `PowerShell`. El hook sale con código 2 en cada bloqueo y con 2 también ante una entrada malformada.
- [ ] CA-2: En una sesión de Claude Code en `main`, pedir "haz commit de este cambio" es bloqueado por el hook con mensaje claro.
- [ ] CA-3: `git commit` en `main` desde terminal es rechazado por el pre-commit.
- [ ] CA-4: Un archivo `.ts` de `src/` editado por el agente queda formateado sin que el agente corra Prettier.
- [ ] CA-5: `/implementar` crea y usa un worktree en `.claude/worktrees/<slug>` (sin carpetas anidadas) y corre la línea base dentro.
- [ ] CA-6: Tras el ruleset (lo confirma el usuario), `git push origin main` desde una rama local es rechazado por GitHub.
- [ ] CA-7: `.claude/settings.json` aparece en `git status` como archivo versionable y `.claude/settings.local.json` sigue ignorado (`git check-ignore -v`).
- [ ] CA-8: `pnpm install` en un directorio sin `.git` termina con exit 0 (simula Vercel/Docker).
- [ ] CA-9: Un comando `aceptacion:` que no empieza por `pnpm `, `node ` o `npx vitest ` no se ejecuta y se avisa.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:** crear el ruleset de `main` (E) y decidir si el admin puede saltárselo.
- R-1: Los hooks de Claude Code no cubren comandos que el usuario corre a mano. Por eso existe la segunda capa (pre-commit) y la tercera (ruleset).
- R-2: Un hook Stop lento degrada la experiencia. Medir antes de dejarlo activo.
- R-3: Windows (el usuario desarrolla en Windows según `vitest.config.ts`): `.githooks/pre-commit` en sh funciona con Git for Windows; el hook de Claude Code en Node es multiplataforma pero la shell que lo lanza no está garantizada. Probar en Windows con ambas herramientas.
- R-4: El bloqueo de `git checkout`/`switch` por "cambios ajenos" es una heurística: puede bloquear de más. Si molesta, se degrada a aviso.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Confirmado: no existe `.claude/settings*`, ni `.githooks/`, ni `core.hooksPath`; 64 de los últimos 215 commits first-parent de `main` no son merges; `vitest.config.ts` excluye `**/.claude/worktrees/**` y `**/.worktrees/**`; `/implementar` crea la rama en el paso 2 sin worktree y verifica `git status` limpio en el paso 1.4.
- Corregido: `.gitignore` ignora `.claude/settings.json` (línea 47); sin quitarla, la spec no se podía cumplir.
- Corregido: el "fast-forward sin checkout" no deja rastro en `git log --all --grep`; se cita como nota del dueño.
- Corregido: el hook solo cubría `Bash`; hay también `PowerShell`.
- Corregido: `prepare: git config …` rompe instalaciones sin `.git`.
- Corregido: el pre-commit debe usar el alcance de `format:check` (solo `src/**`), no todo el repo.
- Corregido: cambiar "docs directo a main" contradice `CLAUDE.md`; se incluye su actualización.
- Corregido: la ruta del worktree con `/` en el nombre de rama crea carpetas anidadas; se usa un slug.
- Confirmado con documentación (agente `claude-code-guide`, doc oficial de Claude Code): eventos `PreToolUse`/`PostToolUse`/`Stop`; estructura `hooks → [{matcher, hooks:[{type:"command", command}]}]`; el comando recibe JSON por stdin (`tool_name`, `tool_input`, `cwd`); **exit 2 bloquea**, otros códigos distintos de 0 no bloquean; alternativa JSON `permissionDecision`; `Stop` puede bloquear con `decision: "block"`/exit 2; las reglas `Bash(...)` de `permissions.deny` son por prefijo y se evaden con opciones intermedias de git (`git -C <ruta> push` no coincide con `Bash(git push *)`), y la doc recomienda un hook `PreToolUse` para eso; `Read(./.env)` y `Read(./.env.*)` son sintaxis válida; `.claude/settings.json` se versiona y `settings.local.json` se ignora; el matcher `Edit|Write` es válido. Fuentes: code.claude.com/docs/en/hooks.md, permissions.md, settings.md, auto-mode-config.md.
- No comprobado: el campo `stop_hook_active` (el reporte no lo encontró; recuerdo que existe, pero no se cita sin verificarlo); el comportamiento de `CLAUDE_PROJECT_DIR` y de la shell por defecto en Windows (solo hay reportes de usuarios en issues, no documentación oficial); la sintaxis de reglas de permisos para la herramienta `PowerShell`.

## 12. Cierre
