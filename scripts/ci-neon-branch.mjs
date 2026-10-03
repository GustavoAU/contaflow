// scripts/ci-neon-branch.mjs — branch efímero de Neon para los tests de integración (SPEC-002)
//
//   node scripts/ci-neon-branch.mjs create   # crea ci-<run>-<intento> y exporta DATABASE_URL_TEST
//   node scripts/ci-neon-branch.mjs delete   # borra ESE branch (idempotente)
//
// Entorno: NEON_API_KEY, NEON_PROJECT_ID, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT
//          (+ GITHUB_OUTPUT / GITHUB_ENV cuando corre dentro de Actions).
//
// AISLAMIENTO (RN-3): NEON_PROJECT_ID es un proyecto DEDICADO al CI (`contaflow-ci`), no el
// de producción, y la key debería ser de alcance de proyecto. El branch `main` de ese
// proyecto es un baseline VACÍO (nada corre contra él); cada corrida clona uno nuevo y
// aplica TODAS las migraciones desde cero. No se usa `init_source: schema-only`: Neon lo
// rechaza (412) en proyectos con el rol heredado `authenticated`, y aquí no hace falta.
// Ningún dato de clientes puede llegar al CI porque producción vive en otro proyecto.
//
// SEGURIDAD (RN-4), por defensa en profundidad aunque la key sea de proyecto:
//  - el nombre del branch se DERIVA de GITHUB_RUN_ID/ATTEMPT; nunca se acepta un id o
//    nombre por argumento ni por entorno;
//  - antes de cada DELETE se re-lee el branch desde la API y pasa por
//    assertDeletableBranch (lista blanca ci-<run>-<intento>, nunca default/primary/
//    protegido, nunca otro proyecto);
//  - el padre es el branch `default` resuelto en cada corrida;
//  - el branch nace con expires_at como red de seguridad si el borrado nunca corre;
//  - la cadena de conexión se enmascara en el log (::add-mask::) antes de escribirla.

import { appendFileSync } from "node:fs";
import {
  assertDeletableBranch,
  ciBranchName,
  maskLine,
  resolveDefaultBranch,
} from "./lib/neon-ci-guards.mjs";

const API = "https://console.neon.tech/api/v2";
const BRANCH_TTL_MS = 3 * 60 * 60 * 1000;
const OPERATION_TIMEOUT_MS = 180_000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const projectId = requireEnv("NEON_PROJECT_ID");
// Un id de proyecto de Neon es [a-z0-9-]; cualquier otra cosa no debe llegar a una URL.
if (!/^[a-z0-9-]{1,60}$/.test(projectId)) throw new Error("NEON_PROJECT_ID con formato inválido");
const apiKey = requireEnv("NEON_API_KEY");

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Sin saltos de línea: el mensaje sale como `::error::` y un cuerpo con "\n::add-mask::"
    // o "\n::set-output" inyectaría comandos de workflow en el log.
    const body = text.slice(0, 300).replace(/[\r\n]+/g, " ");
    throw new Error(`Neon API ${method} ${path} -> ${res.status} ${body}`);
  }
  return text ? JSON.parse(text) : {};
}

const BRANCH_PAGE_LIMIT = 1000;

async function listBranches() {
  const { branches } = await api("GET", `/projects/${projectId}/branches?limit=${BRANCH_PAGE_LIMIT}`);
  const list = branches ?? [];
  // Si la página vino llena puede haber más: no se decide con una vista parcial
  // (el default o el branch propio podrían quedar fuera). Falla cerrado.
  if (list.length >= BRANCH_PAGE_LIMIT) {
    throw new Error(`El proyecto tiene ${BRANCH_PAGE_LIMIT}+ branches: lista posiblemente truncada`);
  }
  return list;
}

async function waitForOperations(operations) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  for (const op of operations ?? []) {
    for (;;) {
      const { operation } = await api("GET", `/projects/${projectId}/operations/${op.id}`);
      if (operation.status === "finished") break;
      if (["failed", "cancelled", "skipped"].includes(operation.status)) {
        throw new Error(`Operación ${op.action} terminó en estado ${operation.status}`);
      }
      if (Date.now() > deadline) throw new Error(`Timeout esperando la operación ${op.action}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function emit(file, line) {
  const target = process.env[file];
  if (target) appendFileSync(target, `${line}\n`);
}

async function create() {
  const name = ciBranchName({
    runId: requireEnv("GITHUB_RUN_ID"),
    runAttempt: requireEnv("GITHUB_RUN_ATTEMPT"),
  });
  const branches = await listBranches();
  const parent = resolveDefaultBranch(branches);
  if (branches.some((b) => b.name === name)) {
    throw new Error(`Ya existe un branch ${name}; se aborta para no reutilizar estado ajeno`);
  }

  const created = await api("POST", `/projects/${projectId}/branches`, {
    branch: {
      name,
      parent_id: parent.id,
      expires_at: new Date(Date.now() + BRANCH_TTL_MS).toISOString(),
    },
    endpoints: [{ type: "read_write" }],
  });
  const branchId = created.branch?.id;
  if (typeof branchId !== "string" || !/^br-[a-z0-9-]+$/.test(branchId)) {
    throw new Error("La API no devolvió un id de branch válido");
  }
  console.log(`Branch creado: ${name} (${branchId}) desde ${parent.name}`);
  await waitForOperations(created.operations);

  const { databases } = await api("GET", `/projects/${projectId}/branches/${branchId}/databases`);
  const { roles } = await api("GET", `/projects/${projectId}/branches/${branchId}/roles`);
  const database = databases.find((d) => d.name === "neondb") ?? databases[0];
  const role = roles.find((r) => r.name === "neondb_owner") ?? roles[0];
  if (!database || !role) throw new Error("El branch no tiene base de datos o rol");

  // Conexión DIRECTA (no pooled): prisma migrate deploy y las transacciones Serializable
  // de los tests no funcionan bien a través del pooler.
  const query = new URLSearchParams({
    branch_id: branchId,
    database_name: database.name,
    role_name: role.name,
    pooled: "false",
  });
  const { uri } = await api("GET", `/projects/${projectId}/connection_uri?${query}`);
  if (typeof uri !== "string" || uri === "") throw new Error("La API no devolvió connection_uri");

  // El comando de enmascarado lleva la URI en claro: solo dentro de Actions, nunca en una terminal local.
  if (process.env.GITHUB_ACTIONS) console.log(maskLine(uri));
  emit("GITHUB_ENV", `DATABASE_URL_TEST=${uri}`);
  emit("GITHUB_ENV", `DATABASE_URL_DIRECT=${uri}`);
  emit("GITHUB_OUTPUT", `branch_name=${name}`);
  emit("GITHUB_OUTPUT", `branch_id=${branchId}`);
}

async function remove() {
  const name = ciBranchName({
    runId: requireEnv("GITHUB_RUN_ID"),
    runAttempt: requireEnv("GITHUB_RUN_ATTEMPT"),
  });
  const branches = await listBranches();
  const matches = branches.filter((b) => b.name === name);
  if (matches.length === 0) {
    console.log(`No existe el branch ${name}: nada que borrar`);
    return;
  }
  // Nombres duplicados: no se adivina cuál es el nuestro.
  if (matches.length > 1) throw new Error(`Hay ${matches.length} branches llamados ${name}: ambiguo`);
  const [branch] = matches;
  const defaultBranch = resolveDefaultBranch(branches);
  assertDeletableBranch({
    branch,
    expectedProjectId: projectId,
    defaultBranchId: defaultBranch.id,
  });
  await api("DELETE", `/projects/${projectId}/branches/${branch.id}`);
  console.log(`Branch borrado: ${name} (${branch.id})`);
}

const command = process.argv[2];
try {
  if (command === "create") await create();
  else if (command === "delete") await remove();
  else throw new Error("Uso: node scripts/ci-neon-branch.mjs <create|delete>");
} catch (error) {
  // El mensaje nunca incluye la key; api() ya quita saltos del cuerpo y aquí se vuelve a
  // garantizar una sola línea para que nada pueda abrir un segundo comando de workflow.
  const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ");
  console.error(`::error::${message}`);
  // exitCode y no process.exit(): salir con handles de fetch abiertos revienta libuv en Windows.
  process.exitCode = 1;
}
