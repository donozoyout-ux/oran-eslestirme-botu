import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonAlertStore, MemoryAlertStore } from "../src/alert-store.js";
import type { AlertSignalState } from "../src/domain.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function state(price = 2.1, pair = "a|b"): AlertSignalState {
  return {
    stateKey: pair,
    metrics: { price, differencePercent: 1 },
    thresholds: { price: { relativePercent: 3 }, differencePercent: { absolute: 0.5 } },
  };
}

describe("AlertStore suppression", () => {
  it("cooldown icinde anlamli degisiklik olsa bile bastirir", async () => {
    const store = new MemoryAlertStore(600);
    const start = new Date("2026-09-07T12:00:00.000Z");
    await store.markSent("stable", start, state());
    expect(store.shouldSend("stable", new Date(start.getTime() + 599_000), state(2.3))).toBe(false);
  });

  it("cooldown sonrasinda kucuk fiyat degisimini bastirip anlamli degisime izin verir", async () => {
    const store = new MemoryAlertStore(600);
    const start = new Date("2026-09-07T12:00:00.000Z");
    await store.markSent("stable", start, state());
    const afterCooldown = new Date(start.getTime() + 601_000);
    expect(store.shouldSend("stable", afterCooldown, state(2.14))).toBe(false);
    expect(store.shouldSend("stable", afterCooldown, state(2.2))).toBe(true);
    expect(store.shouldSend("stable", afterCooldown, state(2.1, "a|c"))).toBe(true);
  });

  it("V1 state dosyasini okuyup V2 olarak kalici hale getirir", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alert-store-"));
    directories.push(directory);
    const file = path.join(directory, "state.json");
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      sentAtByAlertId: { legacy: "2026-09-07T12:00:00.000Z" },
    }));
    const store = new JsonAlertStore(file, 600);
    expect(store.shouldSend("legacy", new Date("2026-09-07T12:05:00.000Z"), state())).toBe(false);
    await store.markSent("new", new Date("2026-09-07T12:05:00.000Z"), state());
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(2);
  });
});
