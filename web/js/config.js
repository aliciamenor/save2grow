// Spec 003 — config for the local feed page.
//
// SUPABASE_URL and SUPABASE_ANON_KEY are the project's *publishable* values — Supabase's own
// design is that these ship inside client-side code; identity and access are enforced by the RLS
// policies in supabase/migrations/0003_local_feed_auth.sql, not by keeping this file secret. The
// service-role key must never appear here or anywhere under web/.
//
// SUPABASE_ANON_KEY below is a placeholder — fill it in from the Supabase dashboard
// (Project Settings → API → "anon public" key) before opening the page. See ARCHITECTURE.md,
// "Spec 003 — Deploying", and learnings/003-smoke-test.md.
export const SUPABASE_URL = "https://ganwkykfudvruvdlxlbm.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_5QsW1pgv_13rUqHsfMXoKg_Z6x097UI";

// Must match exactly what is registered as a redirect URL in the Supabase dashboard
// (Authentication → URL Configuration → Redirect URLs) and the port `evals/serve-check.sh` and
// the smoke-test checklist use. See ARCHITECTURE.md, "Spec 003 — Deploying".
export const REDIRECT_URL = "http://localhost:8787/";
