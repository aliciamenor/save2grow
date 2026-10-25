// Supabase Edge Function: Telegram webhook entry point. Spec 001.
//
// All logic lives in ../_shared (webhook-handler.js, db.js, telegram.js) so it can be unit
// tested under Node without a Deno runtime or live credentials. This file only wires env vars
// and the HTTP boundary.
//
// Owner whitelist (stopping condition in specs/done/001-core-loop.md): Alis confirmed her
// Telegram numeric user ID (2026-10-25). Fast-follow: enforced below via OWNER_TELEGRAM_ID.
// Every sender id is still logged regardless, so a future second user is visible before anyone
// adds them to the allowlist.

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
// @ts-ignore
const OWNER_TELEGRAM_ID = Deno.env.get("OWNER_TELEGRAM_ID");

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
    // Always logged, filter or no filter — visible in `supabase functions logs telegram-webhook`.
    console.log(`telegram sender id: ${id}`);
  };

  // @ts-ignore - loosely-typed update payload, same shape used in _shared/webhook-handler.js.
  const senderId = update?.message?.from?.id ?? update?.callback_query?.from?.id;
  if (OWNER_TELEGRAM_ID && String(senderId) !== String(OWNER_TELEGRAM_ID)) {
    console.log(`ignored sender id ${senderId}: not the owner`);
    return new Response("ok");
  }

  try {
    await handleUpdate(update, { db, telegram, onSenderId });
  } catch (err) {
    console.error("telegram-webhook error:", err);
  }

  return new Response("ok");
});
