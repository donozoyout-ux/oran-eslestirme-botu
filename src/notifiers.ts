import type { Notifier, OddsMatch } from "./domain.js";
import { logger } from "./logger.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function phaseLabel(phase: OddsMatch["phase"]): string {
  return phase === "live" ? "CANLI" : "MAÇ ÖNÜ";
}

function periodLabel(period: OddsMatch["quoteA"]["period"]): string {
  if (period === "first_half") return "İlk Yarı";
  if (period === "second_half") return "İkinci Yarı";
  return "Maç Geneli";
}

function marketLabel(match: OddsMatch): string {
  const labels: Partial<Record<OddsMatch["quoteA"]["marketKey"], string>> = {
    match_winner_3way: "Maç Sonucu (1X2)",
    match_winner_2way: "Maç Kazananı",
    total_goals: "Toplam Gol",
    handicap: "Asya Handikap",
    both_teams_to_score: "Karşılıklı Gol",
    double_chance: "Çifte Şans",
    correct_score: "Doğru Skor",
    corners: "Toplam Korner",
    cards: "Toplam Kart",
    player_prop: "Oyuncu Bahsi",
  };
  return labels[match.quoteA.marketKey] ?? match.quoteA.marketName;
}

function selectionLabel(match: OddsMatch): string {
  const { marketKey, selectionKey, selectionName } = match.quoteA;
  if (["total_goals", "corners", "cards"].includes(marketKey)) {
    if (selectionKey === "over") return "ÜST";
    if (selectionKey === "under") return "ALT";
  }
  if (marketKey === "both_teams_to_score") {
    if (selectionKey === "yes") return "EVET (Var)";
    if (selectionKey === "no") return "HAYIR (Yok)";
  }
  return selectionName;
}

function wholeCountDescription(line: number, selection: string): { win: string; refund?: string } | null {
  if (!Number.isFinite(line)) return null;
  const isInteger = Number.isInteger(line);
  if (selection === "over") {
    return {
      win: `en az ${Math.floor(line) + 1}`,
      refund: isInteger ? `tam ${line} olursa bahis iade edilir` : undefined,
    };
  }
  if (selection === "under") {
    return {
      win: `en fazla ${Math.ceil(line) - 1}`,
      refund: isInteger ? `tam ${line} olursa bahis iade edilir` : undefined,
    };
  }
  return null;
}

export function describeOddsMatch(match: OddsMatch): string {
  const { marketKey, selectionKey, selectionName, line, homeTeam, awayTeam } = match.quoteA;
  const count = line === null ? null : wholeCountDescription(line, selectionKey);
  if (count) {
    const subject =
      marketKey === "total_goals"
        ? "gol"
        : marketKey === "corners"
          ? "korner"
          : marketKey === "cards"
            ? "kart"
            : null;
    if (subject) {
      const countingRule = marketKey === "cards" ? " (kaynağın kart sayım kuralına göre)" : "";
      const refund = count.refund ? `; ${count.refund}` : "";
      return `${periodLabel(match.quoteA.period)} sonunda toplam ${count.win} ${subject} olursa kazanır${refund}${countingRule}.`;
    }
  }

  if (marketKey === "match_winner_3way" || marketKey === "match_winner_2way") {
    if (selectionKey === "home") return `${homeTeam} kazanırsa bahis kazanır.`;
    if (selectionKey === "away") return `${awayTeam} kazanırsa bahis kazanır.`;
    if (selectionKey === "draw") return "Maç berabere biterse bahis kazanır.";
  }
  if (marketKey === "both_teams_to_score") {
    return selectionKey === "yes"
      ? "İki takım da en az birer gol atarsa bahis kazanır."
      : "Takımlardan en az biri gol atamazsa bahis kazanır.";
  }
  if (marketKey === "double_chance") {
    if (selectionKey === "home_or_draw") return `${homeTeam} kazanır veya maç berabere biterse bahis kazanır.`;
    if (selectionKey === "home_or_away") return "Maçı iki takımdan biri kazanırsa bahis kazanır; beraberlikte kaybeder.";
    if (selectionKey === "draw_or_away") return `${awayTeam} kazanır veya maç berabere biterse bahis kazanır.`;
  }
  if (marketKey === "handicap") {
    const signedLine = line === null ? "" : ` ${line > 0 ? "+" : ""}${line}`;
    return `${selectionName}${signedLine} Asya handikap seçimi; sonuç sağlayıcının handikap kuralına göre hesaplanır.`;
  }
  if (marketKey === "custom:draw_no_bet") {
    return `${selectionName} kazanırsa bahis kazanır; beraberlikte bahis iade edilir.`;
  }
  return `${marketLabel(match)} pazarında “${selectionLabel(match)}” seçimi.`;
}

function isSurpriseCandidate(match: OddsMatch, threshold: number): boolean {
  return (match.quoteA.price + match.quoteB.price) / 2 >= threshold;
}

export function formatTelegramMessage(match: OddsMatch, surpriseOddsThreshold = 2.5): string {
  const kickoff = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(match.quoteA.commenceTime));
  const surprise = isSurpriseCandidate(match, surpriseOddsThreshold);
  const line = match.quoteA.line;
  const lines = [
    surprise
      ? `🎯 <b>SÜRPRİZ ADAYI — ${phaseLabel(match.phase)}</b>`
      : `🔔 <b>YAKIN ORAN — ${phaseLabel(match.phase)}</b>`,
    "",
    `⚽ <b>${escapeHtml(match.quoteA.homeTeam)} – ${escapeHtml(match.quoteA.awayTeam)}</b>`,
    `🏆 ${escapeHtml(match.quoteA.leagueName)}`,
    "",
    `📊 <b>Pazar:</b> ${escapeHtml(marketLabel(match))}`,
    `⏱ <b>Periyot:</b> ${escapeHtml(periodLabel(match.quoteA.period))}`,
    ...(line === null ? [] : [`🎚 <b>Çizgi:</b> ${line}`]),
    `↕️ <b>Seçim:</b> ${escapeHtml(selectionLabel(match))}`,
    `🧾 <b>Anlamı:</b> ${escapeHtml(describeOddsMatch(match))}`,
    "",
    `• ${escapeHtml(match.quoteA.bookmakerName)}: <b>${match.quoteA.price.toFixed(2)}</b>`,
    `• ${escapeHtml(match.quoteB.bookmakerName)}: <b>${match.quoteB.price.toFixed(2)}</b>`,
    `📐 Göreli fark: <b>%${match.relativeDifferencePercent.toFixed(2)}</b>`,
    ...(surprise ? [`🎯 Sürpriz eşiği: ortalama oran ≥ <b>${surpriseOddsThreshold.toFixed(2)}</b>`] : []),
    `🕒 Başlangıç: ${kickoff}`,
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
    private readonly surpriseOddsThreshold = 2.5,
  ) {}

  async send(match: OddsMatch): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: formatTelegramMessage(match, this.surpriseOddsThreshold),
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
