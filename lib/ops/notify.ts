// One message to the site owner's own Telegram, for a fault that a person has to look
// at before the server may try again. The first caller is lib/sources/celestrak.ts:
// CelesTrak's usage policy says software must stop at the first non-200 answer and
// report it to a person, and a line in the journal alone reaches nobody.
//
// ITS OWN TWO VARIABLES, NOT THE FEEDBACK BOT'S. Setting FEEDBACK_TELEGRAM_* also
// mounts the in-console feedback prompt for every visitor, so an operator who only
// wants alerts must not have to turn that on. The two may hold the same bot token.
//
// Dormant-safe: unset, it sends nothing. It never throws and never waits longer than
// its timeout, because an alert that fails must not change what the caller does next.
// The text goes to the owner only; it must never carry a visitor's data.

const SEND_TIMEOUT_MS = 8_000;
/** Telegram refuses a message over 4,096 characters. */
const MAX_TEXT = 3_500;

/** Sends `text` to OPS_TELEGRAM_CHAT_ID. True only when Telegram accepted it. */
export async function notifyOwner(text: string): Promise<boolean> {
  const botToken = process.env.OPS_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.OPS_TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_TEXT), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
