-- Spec 004 — Link previews (criterion 4, schema eval).
--
-- Adds nullable Open Graph preview fields to `items`. Populated once at capture time by the
-- Telegram webhook (`supabase/functions/_shared/og-preview.js`), right after the existing
-- "Guardado." reply, for a link item only. All three stay null for an image item, for a link
-- with no OG tags, or when the fetch/parse fails or times out — the feed falls back to the
-- plain-link card in that case (criterion 4).

alter table items
  add column if not exists preview_title text,
  add column if not exists preview_description text,
  add column if not exists preview_image_url text;
