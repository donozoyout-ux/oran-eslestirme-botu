import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN eksik. Once Telegram botuna bir mesaj gonderin, sonra bu komutu calistirin.");
  process.exitCode = 1;
} else {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error(`Telegram ${response.status}: ${(await response.text()).slice(0, 300)}`);
    process.exitCode = 1;
  } else {
    const payload = (await response.json()) as {
      result?: Array<{ message?: { chat?: { id?: number; title?: string; username?: string } } }>;
    };
    const chats = new Map<number, string>();
    for (const update of payload.result ?? []) {
      const chat = update.message?.chat;
      if (chat?.id !== undefined) chats.set(chat.id, chat.title ?? chat.username ?? "ozel sohbet");
    }
    if (chats.size === 0) {
      console.log("Henuz mesaj bulunamadi. Telegram'da bota /start yazip komutu yeniden calistirin.");
    } else {
      for (const [id, name] of chats) console.log(`${name}: TELEGRAM_CHAT_ID=${id}`);
    }
  }
}
