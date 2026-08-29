import fs from "node:fs";
import path from "node:path";
import type { AlertStore } from "./domain.js";
import { errorMessage, logger } from "./logger.js";

interface PersistedState {
  version: 1;
  sentAtByAlertId: Record<string, string>;
}

const ALERT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class JsonAlertStore implements AlertStore {
  private readonly sentAtByAlertId = new Map<string, number>();

  constructor(
    private readonly filePath: string,
    // Geriye donuk config uyumlulugu icin tutuluyor. Ayni alarm kimligi artik
    // cooldown sonunda tekrar gonderilmez; yeni piyasa durumu yeni ID uretir.
    private readonly cooldownSeconds: number,
  ) {
    void this.cooldownSeconds;
    this.load();
  }

  shouldSend(alertId: string, now: Date): boolean {
    this.prune(now);
    return !this.sentAtByAlertId.has(alertId);
  }

  async markSent(alertId: string, now: Date): Promise<void> {
    this.sentAtByAlertId.set(alertId, now.getTime());
    this.prune(now);
    await this.persist();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
      if (!parsed.sentAtByAlertId || typeof parsed.sentAtByAlertId !== "object") return;
      for (const [id, value] of Object.entries(parsed.sentAtByAlertId)) {
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) this.sentAtByAlertId.set(id, timestamp);
      }
      this.prune(new Date());
    } catch (error) {
      logger.warn("Bildirim durumu okunamadi; bos durumla baslanacak.", { error: errorMessage(error) });
    }
  }

  private prune(now: Date): void {
    for (const [id, timestamp] of this.sentAtByAlertId) {
      if (now.getTime() - timestamp > ALERT_RETENTION_MS) this.sentAtByAlertId.delete(id);
    }
  }

  private async persist(): Promise<void> {
    const state: PersistedState = {
      version: 1,
      sentAtByAlertId: Object.fromEntries(
        [...this.sentAtByAlertId.entries()].map(([id, timestamp]) => [id, new Date(timestamp).toISOString()]),
      ),
    };
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}

export class MemoryAlertStore implements AlertStore {
  private readonly sentAtByAlertId = new Map<string, number>();

  constructor(private readonly cooldownSeconds: number) {
    void this.cooldownSeconds;
  }

  shouldSend(alertId: string, now: Date): boolean {
    this.prune(now);
    return !this.sentAtByAlertId.has(alertId);
  }

  async markSent(alertId: string, now: Date): Promise<void> {
    this.sentAtByAlertId.set(alertId, now.getTime());
    this.prune(now);
  }

  private prune(now: Date): void {
    for (const [id, timestamp] of this.sentAtByAlertId) {
      if (now.getTime() - timestamp > ALERT_RETENTION_MS) this.sentAtByAlertId.delete(id);
    }
  }
}
