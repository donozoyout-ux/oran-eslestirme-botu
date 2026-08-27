import fs from "node:fs";
import path from "node:path";
import type { AlertStore } from "./domain.js";
import { errorMessage, logger } from "./logger.js";

interface PersistedState {
  version: 1;
  sentAtByAlertId: Record<string, string>;
}

export class JsonAlertStore implements AlertStore {
  private readonly sentAtByAlertId = new Map<string, number>();

  constructor(
    private readonly filePath: string,
    private readonly cooldownSeconds: number,
  ) {
    this.load();
  }

  shouldSend(alertId: string, now: Date): boolean {
    const lastSentAt = this.sentAtByAlertId.get(alertId);
    if (lastSentAt === undefined) return true;
    return now.getTime() - lastSentAt >= this.cooldownSeconds * 1000;
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
    } catch (error) {
      logger.warn("Bildirim durumu okunamadi; bos durumla baslanacak.", { error: errorMessage(error) });
    }
  }

  private prune(now: Date): void {
    const retentionMs = Math.max(this.cooldownSeconds * 3, 86_400) * 1000;
    for (const [id, timestamp] of this.sentAtByAlertId) {
      if (now.getTime() - timestamp > retentionMs) this.sentAtByAlertId.delete(id);
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

  constructor(private readonly cooldownSeconds: number) {}

  shouldSend(alertId: string, now: Date): boolean {
    const sentAt = this.sentAtByAlertId.get(alertId);
    return sentAt === undefined || now.getTime() - sentAt >= this.cooldownSeconds * 1000;
  }

  async markSent(alertId: string, now: Date): Promise<void> {
    this.sentAtByAlertId.set(alertId, now.getTime());
  }
}
