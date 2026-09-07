import fs from "node:fs";
import path from "node:path";
import type { AlertSignalState, AlertStore } from "./domain.js";
import { errorMessage, logger } from "./logger.js";

interface AlertRecord {
  sentAt: number;
  state?: Pick<AlertSignalState, "stateKey" | "metrics">;
}

interface PersistedStateV1 {
  version: 1;
  sentAtByAlertId: Record<string, string>;
}

interface PersistedStateV2 {
  version: 2;
  alerts: Record<string, { sentAt: string; state?: Pick<AlertSignalState, "stateKey" | "metrics"> }>;
}

interface PersistedStateInput {
  version?: number;
  sentAtByAlertId?: Record<string, string>;
  alerts?: PersistedStateV2["alerts"];
}

const MIN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function finiteMetrics(metrics: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value)));
}

function snapshot(state: AlertSignalState | undefined): AlertRecord["state"] {
  if (!state) return undefined;
  return { stateKey: state.stateKey, metrics: finiteMetrics(state.metrics) };
}

function metricChanged(previous: number, current: number, absolute?: number, relativePercent?: number): boolean {
  if (absolute !== undefined && Math.abs(current - previous) >= absolute) return true;
  if (relativePercent !== undefined && previous !== 0) {
    return Math.abs((current - previous) / previous) * 100 >= relativePercent;
  }
  return false;
}

function hasMeaningfulChange(previous: AlertRecord["state"], current: AlertSignalState): boolean {
  if (!previous) return true;
  if (previous.stateKey !== current.stateKey) return true;
  for (const [name, threshold] of Object.entries(current.thresholds)) {
    const before = previous.metrics[name];
    const after = current.metrics[name];
    if (before === undefined || after === undefined) continue;
    if (metricChanged(before, after, threshold.absolute, threshold.relativePercent)) return true;
  }
  return false;
}

abstract class BaseAlertStore implements AlertStore {
  protected readonly records = new Map<string, AlertRecord>();
  private readonly cooldownMs: number;
  private readonly retentionMs: number;

  constructor(cooldownSeconds: number) {
    this.cooldownMs = Math.max(0, cooldownSeconds) * 1_000;
    this.retentionMs = Math.max(MIN_RETENTION_MS, this.cooldownMs * 2);
  }

  shouldSend(alertId: string, now: Date, state?: AlertSignalState): boolean {
    this.prune(now);
    const previous = this.records.get(alertId);
    if (!previous) return true;
    if (now.getTime() - previous.sentAt < this.cooldownMs) return false;
    // State kullanmayan eski cagri noktalarinda klasik cooldown davranisi.
    // Telegram state'i varsa sadece anlamli yeni durum tekrar gonderilir.
    return state ? hasMeaningfulChange(previous.state, state) : true;
  }

  async markSent(alertId: string, now: Date, state?: AlertSignalState): Promise<void> {
    this.records.set(alertId, { sentAt: now.getTime(), state: snapshot(state) });
    this.prune(now);
    await this.afterMutation();
  }

  protected prune(now: Date): void {
    for (const [id, record] of this.records) {
      if (now.getTime() - record.sentAt > this.retentionMs) this.records.delete(id);
    }
  }

  protected abstract afterMutation(): Promise<void>;
}

export class JsonAlertStore extends BaseAlertStore {
  constructor(
    private readonly filePath: string,
    cooldownSeconds: number,
  ) {
    super(cooldownSeconds);
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PersistedStateInput;
      if (parsed.version === 2 && parsed.alerts && typeof parsed.alerts === "object") {
        for (const [id, value] of Object.entries(parsed.alerts)) {
          const sentAt = Date.parse(value.sentAt);
          if (Number.isFinite(sentAt)) this.records.set(id, { sentAt, state: value.state });
        }
      } else if (parsed.sentAtByAlertId && typeof parsed.sentAtByAlertId === "object") {
        // V1 dosyalari kayipsiz okunur; ilk cooldown sonrasi yeni state kaydedilir.
        for (const [id, value] of Object.entries(parsed.sentAtByAlertId)) {
          const sentAt = Date.parse(value);
          if (Number.isFinite(sentAt)) this.records.set(id, { sentAt });
        }
      }
      this.prune(new Date());
    } catch (error) {
      logger.warn("Bildirim durumu okunamadi; bos durumla baslanacak.", { error: errorMessage(error) });
    }
  }

  protected async afterMutation(): Promise<void> {
    const state: PersistedStateV2 = {
      version: 2,
      alerts: Object.fromEntries(
        [...this.records.entries()].map(([id, record]) => [id, {
          sentAt: new Date(record.sentAt).toISOString(),
          ...(record.state ? { state: record.state } : {}),
        }]),
      ),
    };
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}

export class MemoryAlertStore extends BaseAlertStore {
  constructor(cooldownSeconds: number) {
    super(cooldownSeconds);
  }

  protected async afterMutation(): Promise<void> {}
}
