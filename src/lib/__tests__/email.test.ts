// src/lib/__tests__/email.test.ts
// Unit tests for EmailService — Resend REST API wrapper

import { describe, it, expect, vi, beforeEach } from "vitest";

// Each test imports sendEmail fresh to pick up env var changes
// (vi.resetModules() in beforeEach)

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Default: no API key
  delete process.env.RESEND_API_KEY;
  global.fetch = vi.fn();
});

describe("sendEmail", () => {
  it("retorna ok:false y error si RESEND_API_KEY no está configurado", async () => {
    const { sendEmail } = await import("@/lib/email");
    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>hi</p>" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/RESEND_API_KEY/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("llama a Resend API con los headers correctos", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg-123" }),
    } as Response);

    const { sendEmail } = await import("@/lib/email");
    const result = await sendEmail({ to: "admin@empresa.com", subject: "Asunto", html: "<p>body</p>" });

    expect(result.ok).toBe(true);
    expect(result.id).toBe("msg-123");

    const [url, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_test_key");
    const body = JSON.parse(opts.body as string);
    expect(body.to).toContain("admin@empresa.com");
    expect(body.subject).toBe("Asunto");
  });

  it("acepta array de destinatarios", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg-456" }),
    } as Response);

    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to: ["a@b.com", "c@d.com"], subject: "Multi", html: "<p>hi</p>" });

    const [, opts] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
  });

  it("retorna ok:false si Resend responde con error HTTP", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Invalid from address",
    } as Response);

    const { sendEmail } = await import("@/lib/email");
    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("422");
  });

  it("retorna ok:false si fetch lanza (red caída)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.mocked(global.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const { sendEmail } = await import("@/lib/email");
    const result = await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
