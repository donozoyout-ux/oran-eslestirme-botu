import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramStartupMessage } from "../src/telegram-health.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram startup health", () => {
  it("servis acilisinda Telegram sendMessage endpointine test mesaji yollar", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { chat_id?: string; text?: string };
      expect(body.chat_id).toBe("12345");
      expect(body.text).toContain("botu aktif");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramStartupMessage("token", "12345");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/bottoken/sendMessage");
  });

  it("Telegram hatasini gizlemez", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(sendTelegramStartupMessage("bad", "12345")).rejects.toThrow("Telegram startup 401");
  });
});
