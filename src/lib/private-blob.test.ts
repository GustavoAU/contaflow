// src/lib/private-blob.test.ts
// Invariantes de src/lib/private-blob.ts (ADR-047): es el ÚNICO sitio que toca el SDK de Vercel Blob y el que elige
// la credencial.
//
//  - EN VERCEL (VERCEL definido) el SDK debe autenticarse por OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID). Un `token`
//    explícito GANA sobre OIDC, así que aquí NUNCA se pasa la clave `token`, aunque BLOB_READ_WRITE_TOKEN siga
//    declarado en el panel: si se pasara, el proyecto volvería a depender de un secreto de larga vida.
//  - FUERA DE VERCEL (desarrollo local, scripts) un token OIDC dura 12 h, así que se pasa el token estático.
//
// Cada test declara el entorno COMPLETO (undefined = variable ausente): lo que tenga el shell de quien corre la suite
// (VERCEL=1 tras `vercel dev`, un token en .env.local) no puede colarse en el resultado.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);

import { deletePrivateBlob, getPrivateBlob, isPrivateBlobConfigured, putPrivateBlob } from "./private-blob";

type BlobEnv = { VERCEL?: string; BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string };

const STATIC_TOKEN = "vercel_blob_rw_TOKEN_ESTATICO_DE_PRUEBA";
const STORE_ID = "store_abc123";
const PATHNAME = "fiscal/company-1/libro-ventas-2026-09.pdf";
const BLOB_URL = `https://${STORE_ID}.private.blob.vercel-storage.com/${PATHNAME}`;
const PDF = Buffer.from("%PDF-fake");

// En Vercel el token estático sigue definido A PROPÓSITO: es el caso que debe perder contra OIDC.
const VERCEL_ENV: BlobEnv = { VERCEL: "1", BLOB_STORE_ID: STORE_ID, BLOB_READ_WRITE_TOKEN: STATIC_TOKEN };
// Fuera de Vercel BLOB_STORE_ID también está definido: solo el token debe importar.
const LOCAL_ENV: BlobEnv = { BLOB_STORE_ID: STORE_ID, BLOB_READ_WRITE_TOKEN: STATIC_TOKEN };

function setEnv(env: BlobEnv) {
  vi.stubEnv("VERCEL", env.VERCEL);
  vi.stubEnv("BLOB_STORE_ID", env.BLOB_STORE_ID);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", env.BLOB_READ_WRITE_TOKEN);
}

/** Opciones que el módulo pasó al SDK en la única llamada del test (posición del argumento `options`). */
function optionsOf(fn: typeof sdk.put | typeof sdk.get | typeof sdk.del, argIndex: number): Record<string, unknown> {
  expect(fn).toHaveBeenCalledOnce();
  return fn.mock.calls[0][argIndex] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.put.mockResolvedValue({ url: BLOB_URL, pathname: PATHNAME });
  sdk.get.mockResolvedValue({ statusCode: 200, stream: null });
  sdk.del.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── (a) EN VERCEL: OIDC, sin token ───────────────────────────────────────────

describe("en Vercel (VERCEL=1): la credencial la pone OIDC, nunca un token", () => {
  beforeEach(() => setEnv(VERCEL_ENV));

  it("putPrivateBlob no pasa la clave `token` aunque BLOB_READ_WRITE_TOKEN esté definido", async () => {
    await putPrivateBlob(PATHNAME, PDF, "application/pdf");

    const options = optionsOf(sdk.put, 2);
    expect(Object.keys(options)).not.toContain("token");
    expect(JSON.stringify(options)).not.toContain(STATIC_TOKEN);
  });

  it("getPrivateBlob no pasa la clave `token` aunque BLOB_READ_WRITE_TOKEN esté definido", async () => {
    await getPrivateBlob(PATHNAME);

    const options = optionsOf(sdk.get, 1);
    expect(Object.keys(options)).not.toContain("token");
    expect(JSON.stringify(options)).not.toContain(STATIC_TOKEN);
  });

  it("deletePrivateBlob no pasa la clave `token` aunque BLOB_READ_WRITE_TOKEN esté definido", async () => {
    await deletePrivateBlob(BLOB_URL);

    const options = optionsOf(sdk.del, 1);
    expect(Object.keys(options)).not.toContain("token");
    expect(JSON.stringify(options)).not.toContain(STATIC_TOKEN);
  });

  it("isPrivateBlobConfigured es true si hay BLOB_STORE_ID (el token estático no cuenta)", () => {
    setEnv({ VERCEL: "1", BLOB_STORE_ID: STORE_ID, BLOB_READ_WRITE_TOKEN: undefined });

    expect(isPrivateBlobConfigured()).toBe(true);
  });

  it("isPrivateBlobConfigured es false sin BLOB_STORE_ID aunque exista el token estático", () => {
    setEnv({ VERCEL: "1", BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: STATIC_TOKEN });

    expect(isPrivateBlobConfigured()).toBe(false);
  });

  it("isPrivateBlobConfigured es false si BLOB_STORE_ID está declarado vacío", () => {
    setEnv({ VERCEL: "1", BLOB_STORE_ID: "", BLOB_READ_WRITE_TOKEN: STATIC_TOKEN });

    expect(isPrivateBlobConfigured()).toBe(false);
  });
});

// ─── (b) FUERA DE VERCEL: token estático ──────────────────────────────────────

describe("fuera de Vercel (VERCEL sin definir): se pasa el token estático de BLOB_READ_WRITE_TOKEN", () => {
  beforeEach(() => setEnv(LOCAL_ENV));

  it("putPrivateBlob pasa `token` con el valor exacto de BLOB_READ_WRITE_TOKEN", async () => {
    await putPrivateBlob(PATHNAME, PDF, "application/pdf");

    expect(optionsOf(sdk.put, 2).token).toBe(STATIC_TOKEN);
  });

  it("getPrivateBlob pasa `token` con el valor exacto de BLOB_READ_WRITE_TOKEN", async () => {
    await getPrivateBlob(PATHNAME);

    expect(optionsOf(sdk.get, 1).token).toBe(STATIC_TOKEN);
  });

  it("deletePrivateBlob pasa `token` con el valor exacto de BLOB_READ_WRITE_TOKEN", async () => {
    await deletePrivateBlob(BLOB_URL);

    expect(optionsOf(sdk.del, 1)).toStrictEqual({ token: STATIC_TOKEN });
  });

  it("la credencial se lee en cada llamada: un cambio de BLOB_READ_WRITE_TOKEN se refleja sin recargar el módulo", async () => {
    await putPrivateBlob(PATHNAME, PDF, "application/pdf");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_OTRO_TOKEN");
    await putPrivateBlob(PATHNAME, PDF, "application/pdf");

    expect(sdk.put.mock.calls[0][2].token).toBe(STATIC_TOKEN);
    expect(sdk.put.mock.calls[1][2].token).toBe("vercel_blob_rw_OTRO_TOKEN");
  });

  it("VERCEL declarada vacía no cuenta como estar en Vercel: se sigue usando el token estático", async () => {
    setEnv({ ...LOCAL_ENV, VERCEL: "" });

    await getPrivateBlob(PATHNAME);

    expect(optionsOf(sdk.get, 1).token).toBe(STATIC_TOKEN);
    expect(isPrivateBlobConfigured()).toBe(true);
  });

  it("isPrivateBlobConfigured es true si hay token (BLOB_STORE_ID no hace falta)", () => {
    setEnv({ BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: STATIC_TOKEN });

    expect(isPrivateBlobConfigured()).toBe(true);
  });

  it("isPrivateBlobConfigured es false sin token aunque exista BLOB_STORE_ID", () => {
    setEnv({ BLOB_STORE_ID: STORE_ID, BLOB_READ_WRITE_TOKEN: undefined });

    expect(isPrivateBlobConfigured()).toBe(false);
  });

  it("isPrivateBlobConfigured es false si el token está declarado vacío", () => {
    setEnv({ BLOB_STORE_ID: STORE_ID, BLOB_READ_WRITE_TOKEN: "" });

    expect(isPrivateBlobConfigured()).toBe(false);
  });
});

// ─── (c) putPrivateBlob: opciones del SDK ─────────────────────────────────────

describe("putPrivateBlob: opciones fijas hacia el SDK (iguales en ambos entornos)", () => {
  it.each([
    ["en Vercel (OIDC)", VERCEL_ENV, {}],
    ["fuera de Vercel (token)", LOCAL_ENV, { token: STATIC_TOKEN }],
  ] as const)("%s: access private, contentType, allowOverwrite false y addRandomSuffix false por defecto", async (_label, env, creds) => {
    setEnv(env);

    await putPrivateBlob(PATHNAME, PDF, "application/pdf");

    expect(sdk.put).toHaveBeenCalledOnce();
    const [pathname, body, options] = sdk.put.mock.calls[0];
    expect(pathname).toBe(PATHNAME);
    expect(body).toBe(PDF);
    // toStrictEqual: una clave extra (o `token: undefined` en Vercel) rompe el test.
    expect(options).toStrictEqual({
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: false,
      allowOverwrite: false,
      ...creds,
    });
  });

  it("reenvía el contentType recibido (no lo fija a application/pdf)", async () => {
    setEnv(LOCAL_ENV);

    await putPrivateBlob("co-1/payments/pay-1/x.png", Buffer.from("png"), "image/png");

    expect(optionsOf(sdk.put, 2).contentType).toBe("image/png");
  });

  it("addRandomSuffix es true cuando se pide { addRandomSuffix: true }", async () => {
    setEnv(LOCAL_ENV);

    await putPrivateBlob(PATHNAME, PDF, "application/pdf", { addRandomSuffix: true });

    const options = optionsOf(sdk.put, 2);
    expect(options.addRandomSuffix).toBe(true);
    // El sufijo no relaja el resto de invariantes.
    expect(options.access).toBe("private");
    expect(options.allowOverwrite).toBe(false);
  });

  it("addRandomSuffix es false con opciones vacías y con { addRandomSuffix: false } explícito", async () => {
    setEnv(LOCAL_ENV);

    await putPrivateBlob(PATHNAME, PDF, "application/pdf", {});
    await putPrivateBlob(PATHNAME, PDF, "application/pdf", { addRandomSuffix: false });

    expect(sdk.put.mock.calls[0][2].addRandomSuffix).toBe(false);
    expect(sdk.put.mock.calls[1][2].addRandomSuffix).toBe(false);
  });

  it("devuelve el resultado del SDK tal cual (la acción de exportar guarda result.url)", async () => {
    setEnv(LOCAL_ENV);

    await expect(putPrivateBlob(PATHNAME, PDF, "application/pdf")).resolves.toEqual({
      url: BLOB_URL,
      pathname: PATHNAME,
    });
  });

  it("no traga el error del SDK: el llamador decide qué hacer si la subida falla", async () => {
    setEnv(LOCAL_ENV);
    sdk.put.mockRejectedValue(new Error("blob store unavailable"));

    await expect(putPrivateBlob(PATHNAME, PDF, "application/pdf")).rejects.toThrow("blob store unavailable");
  });
});

// ─── (d) getPrivateBlob: pathname + señal ─────────────────────────────────────

describe("getPrivateBlob", () => {
  beforeEach(() => setEnv(LOCAL_ENV));

  it("reenvía el AbortSignal recibido (la misma instancia): si el cliente corta, el SDK cancela la lectura", async () => {
    const controller = new AbortController();

    await getPrivateBlob(PATHNAME, controller.signal);

    const options = optionsOf(sdk.get, 1);
    expect(options.abortSignal).toBe(controller.signal);
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect((options.abortSignal as AbortSignal).aborted).toBe(true);
  });

  it("sin señal, abortSignal queda undefined (no inventa una)", async () => {
    await getPrivateBlob(PATHNAME);

    expect(optionsOf(sdk.get, 1).abortSignal).toBeUndefined();
  });

  it("pide el PATHNAME recibido con access private (no una URL)", async () => {
    await getPrivateBlob(PATHNAME, new AbortController().signal);

    expect(sdk.get.mock.calls[0][0]).toBe(PATHNAME);
    expect(optionsOf(sdk.get, 1).access).toBe("private");
  });

  it("en Vercel tampoco pasa token pero conserva access y señal", async () => {
    setEnv(VERCEL_ENV);
    const controller = new AbortController();

    await getPrivateBlob(PATHNAME, controller.signal);

    expect(optionsOf(sdk.get, 1)).toStrictEqual({ access: "private", abortSignal: controller.signal });
  });

  it("devuelve lo que devuelve el SDK, incluido null cuando el blob no existe", async () => {
    sdk.get.mockResolvedValue(null);

    await expect(getPrivateBlob(PATHNAME)).resolves.toBeNull();
  });

  it("no traga el error del SDK (la ruta de descarga lo convierte en 502)", async () => {
    sdk.get.mockRejectedValue(new Error("store caído"));

    await expect(getPrivateBlob(PATHNAME)).rejects.toThrow("store caído");
  });
});

// ─── (e) deletePrivateBlob: URL ───────────────────────────────────────────────

describe("deletePrivateBlob", () => {
  beforeEach(() => setEnv(LOCAL_ENV));

  it("reenvía la URL recibida, sin transformarla", async () => {
    await deletePrivateBlob(BLOB_URL);

    expect(sdk.del).toHaveBeenCalledOnce();
    expect(sdk.del.mock.calls[0][0]).toBe(BLOB_URL);
  });

  it("no traga el error del SDK", async () => {
    sdk.del.mockRejectedValue(new Error("no se pudo borrar"));

    await expect(deletePrivateBlob(BLOB_URL)).rejects.toThrow("no se pudo borrar");
  });
});

// ─── Arquitectura: private-blob.ts es el único que importa el SDK ─────────────
// Si otro archivo vuelve a importar `put`/`get`/`del` de @vercel/blob, decide él la credencial: puede volver a pasar
// el token estático en Vercel y anular OIDC, o dejar un store privado accedido con access "public".

describe("arquitectura: solo src/lib/private-blob.ts importa @vercel/blob", () => {
  const ROOT = path.resolve(process.cwd());
  const ALLOWED = new Set(["src/lib/private-blob.ts"]);
  const SDK_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']@vercel\/blob["']/;

  function collectSources(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectSources(full, out);
      else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const rel = (abs: string) => abs.replace(ROOT + path.sep, "").replace(/\\/g, "/");

  it("ningún otro archivo de producción de src/ importa el SDK", () => {
    const offenders = collectSources(path.join(ROOT, "src"))
      .filter((file) => SDK_IMPORT.test(fs.readFileSync(file, "utf8")))
      .map(rel)
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  it("el detector funciona: private-blob.ts sí importa el SDK (evita un guard que nunca puede fallar)", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/private-blob.ts"), "utf8");

    expect(SDK_IMPORT.test(source)).toBe(true);
    expect(collectSources(path.join(ROOT, "src")).map(rel)).toContain("src/lib/private-blob.ts");
  });
});
