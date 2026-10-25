// Supabase Edge Function: daily prioritized push. Spec 001, criterion 4.
//
// Triggered by the GitHub Actions cron workflow (.github/workflows/daily-push.yml), not by
// Telegram. All logic lives in ../_shared/push-handler.js for unit testing under Node.

// @ts-ignore
import { runDailyPush } from "../_shared/push-handler.js";
// @ts-ignore
import { makeDb } from "../_shared/db.js";
// @ts-ignore
import { makeTelegram } from "../_shared/telegram.js";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// @ts-ignore
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

// @ts-ignore
Deno.serve(async (_req: Request) => {
  const db = makeDb({ url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY });
  const telegram = makeTelegram(TELEGRAM_BOT_TOKEN);

  try {
    const sends = await runDailyPush(db, telegram);
    return new Response(JSON.stringify({ sent: sends.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("daily-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
