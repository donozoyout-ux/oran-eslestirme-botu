import type { Notifier, OddsMatch } from "./domain.js";
import { logger } from "./logger.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function phaseLabel(phase: OddsMatch["phase"]): string {
  return phase === "live" ? "CANLI" : "MAC ONU";
}

function lineLabel(match: OddsMatch): string {
  return match.quoteA.line === null ? "" : ` (${match.quoteA.line})`;
}

export function formatTelegramMessage(match: OddsMatch): string {
  const kickoff = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(match.quoteA.commenceTime));
  const lines = [
    `🔔 <b>Yakin Oran — ${phaseLabel(match.phase)}</b>`,
    "",
    `⚽ <b>${escapeHtml(match.quoteA.homeTeam)} – ${escapeHtml(match.quoteA.awayTeam)}</b>`,
    `🏆 ${escapeHtml(match.quoteA.leagueName)}`,
    `📌 ${escapeHtml(match.quoteA.marketName)} / ${escapeHtml(match.quoteA.selectionName)}${lineLabel(match)}`,
    "",
    `• ${escapeHtml(match.quoteA.bookmakerName)}: <b>${match.quoteA.price.toFixed(2)}</b>`,
    `• ${escapeHtml(match.quoteB.bookmakerName)}: <b>${match.quoteB.price.toFixed(2)}</b>`,
    `📐 Goreli fark: <b>%${match.relativeDifferencePercent.toFixed(2)}</b>`,
    `🕒 Baslangic: ${kickoff}`,
    "",
    `<code>${match.id}</code>`,
  ];
  return lines.join("\n");
}

export class ConsoleNotifier implements Notifier {
  readonly name = "console";

  async send(match: OddsMatch): Promise<void> {
    logger.info("DRY RUN bildirim", {
      alertId: match.id,
      event: `${match.quoteA.homeTeam} - ${match.quoteA.awayTeam}`,
      phase: match.phase,
      market: match.marketSignature,
      bookmakerA: match.quoteA.bookmakerName,
      priceA: match.quoteA.price,
      bookmakerB: match.quoteB.bookmakerName,
      priceB: match.quoteB.price,
      differencePercent: Number(match.relativeDifferencePercent.toFixed(4)),
    });
  }
}

export class TelegramNotifier implements Notifier {
  readonly name = "telegram";

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(match: OddsMatch): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: formatTelegramMessage(match),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Telegram ${response.status}: ${body}`);
    }
  }
}
