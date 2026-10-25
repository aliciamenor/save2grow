// Supabase Edge Function: Telegram webhook entry point. Spec 001.
//
// All logic lives in ../_shared (webhook-handler.js, db.js, telegram.js) so it can be unit
// tested under Node without a Deno runtime or live credentials. This file only wires env vars
// and the HTTP boundary.
//
// Owner whitelist (stopping condition in specs/done/001-core-loop.md): Alis's Telegram numeric user
// ID is not confirmed yet. This does NOT invent or enforce one — it logs the sender's numeric ID
// on every incoming message/callback so the filter can be turned on in a fast-follow commit once
// she confirms it.

// @ts-ignore - Deno global, not a Node type.
import { handleUpdate } from "../_shared/webhook-handler.js";
// @ts-ignore
import { makeDb } from "../_shared/db.js";
// @ts-ignore
import { makeTelegram } from "../_shared/telegram.js";

// @ts-ignore - Deno global.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// @ts-ignore
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

// @ts-ignore - Deno global.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("ok");
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const db = makeDb({ url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY });
  const telegram = makeTelegram(TELEGRAM_BOT_TOKEN);

  const onSenderId = (id: number | undefined) => {
    // Visible in `supabase functions logs telegram-webhook`. Not enforced as a filter yet —
    // see the stopping condition in specs/done/001-core-loop.md.
    console.log(`telegram sender id: ${id}`);
  };

  try {
    await handleUpdate(update, { db, telegram, onSenderId });
  } catch (err) {
    console.error("telegram-webhook error:", err);
  }

  return new Response("ok");
});
