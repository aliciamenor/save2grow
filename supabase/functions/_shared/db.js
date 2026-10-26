// Thin fetch-based wrapper over Supabase's PostgREST + Storage APIs. No @supabase/supabase-js
// dependency: keeps the stack to fetch + Deno/Node built-ins, nothing more (spec 001, delegated
// decision on runtime — fewest moving parts; spec 002 keeps the same pattern for Storage).
//
// Runs identically under Deno (Edge Functions) and Node (tests), since it only uses global fetch.

const IMAGE_BUCKET = "item-images";

export function makeDb({ url, key }) {
  const base = `${url}/rest/v1`;
  const storageBase = `${url}/storage/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function get(path) {
    const res = await fetch(`${base}/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function post(path, body, { single = true } = {}) {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return single ? rows[0] : rows;
  }

  async function patch(path, body) {
    const res = await fetch(`${base}/${path}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  return {
    async insertItem({ chat_id, link = null, image_path = null, status = "pending" }) {
      return post("items", { chat_id, link, image_path, status });
    },

    // Spec 005 criterion 1 — a plain `select` before insert, the delegated decision's simplest
    // option given this file's existing `get`-wrapper pattern (no new dependency, no unique
    // constraint/conflict handling to add). Any status counts as "already saved" (closed
    // decision, Gate 1, 2026-10-26), so the query has no `status` filter. `encodeURIComponent`
    // guards the PostgREST query string against a link containing `&`/`=`/etc.
    async findItemByLink(link) {
      const rows = await get(`items?link=eq.${encodeURIComponent(link)}&limit=1`);
      return rows[0] || null;
    },

    // Criterion 3: oldest 3 pending items overall — objective is gone from this scope, so there
    // is no per-objective grouping left to select within.
    async getPendingItems(limit) {
      return get(`items?status=eq.pending&order=created_at.asc&limit=${limit}`);
    },

    async updateItemStatus(itemId, status) {
      return patch(`items?id=eq.${itemId}`, { status });
    },

    // Spec 004 criterion 4: writes the fetched Open Graph preview fields onto an item. Called at
    // most once per link item, right after capture — see _shared/webhook-handler.js.
    async updateItemPreview(itemId, { title = null, description = null, image = null } = {}) {
      return patch(`items?id=eq.${itemId}`, {
        preview_title: title,
        preview_description: description,
        preview_image_url: image,
      });
    },

    // Criterion 2: upload the downloaded photo bytes to the private `item-images` bucket.
    async uploadImage(path, bytes, contentType) {
      const res = await fetch(`${storageBase}/object/${IMAGE_BUCKET}/${path}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": contentType || "application/octet-stream",
        },
        body: bytes,
      });
      if (!res.ok) {
        throw new Error(`storage upload ${path} failed: ${res.status} ${await res.text()}`);
      }
      return { path };
    },

    // Used by the daily push to hand Telegram a usable URL for a private-bucket image, without
    // ever making the bucket itself public.
    async getSignedUrl(path, expiresIn = 3600) {
      const res = await fetch(`${storageBase}/object/sign/${IMAGE_BUCKET}/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) {
        throw new Error(`sign url ${path} failed: ${res.status} ${await res.text()}`);
      }
      const { signedURL } = await res.json();
      return `${storageBase}${signedURL}`;
    },
  };
}
