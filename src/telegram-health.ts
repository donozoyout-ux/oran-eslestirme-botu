export async function sendTelegramStartupMessage(botToken: string, chatId: string): Promise<void> {
  const text = [
    "✅ Oran eşleştirme botu aktif",
    "",
    "Railway servisi başladı ve Telegram bağlantısı çalışıyor.",
    "Canlı maç / yakın oran / piyasa sinyalleri geldikçe bildirim gönderilecek.",
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Telegram startup ${response.status}: ${body}`);
  }
}
