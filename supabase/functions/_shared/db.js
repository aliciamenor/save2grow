// Thin fetch-based wrapper over Supabase's PostgREST API. No @supabase/supabase-js dependency:
// keeps the stack to fetch + Deno/Node built-ins, nothing more (spec 001, delegated decision on
// runtime — fewest moving parts).
//
// Runs identically under Deno (Edge Functions) and Node (tests), since it only uses global fetch.

export function makeDb({ url, key }) {
  const base = `${url}/rest/v1`;
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

  async function del(path) {
    const res = await fetch(`${base}/${path}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
  }

  return {
    async listObjectives(chatId) {
      return get(`objectives?chat_id=eq.${chatId}&order=created_at.asc`);
    },

    async listAllObjectives() {
      return get(`objectives?order=created_at.asc`);
    },

    async insertObjective(chatId, name) {
      return post("objectives", { chat_id: chatId, name });
    },

    async insertCapture(chatId, link) {
      return post("captures", { chat_id: chatId, link });
    },

    async getCapture(id) {
      const rows = await get(`captures?id=eq.${id}`);
      return rows[0];
    },

    async deleteCapture(id) {
      return del(`captures?id=eq.${id}`);
    },

    async insertItem({ objective_id, chat_id, link, status = "pending" }) {
      return post("items", { objective_id, chat_id, link, status });
    },

    async getPendingItemsByObjective(objectiveId, limit) {
      return get(
        `items?objective_id=eq.${objectiveId}&status=eq.pending&order=created_at.asc&limit=${limit}`
      );
    },

    async updateItemStatus(itemId, status) {
      return patch(`items?id=eq.${itemId}`, { status });
    },

    async setPendingAction(chatId, captureId) {
      // One pending "awaiting objective name" per chat — upsert via delete + insert, since
      // PostgREST upsert needs a Prefer header variant; simplest here is overwrite.
      await del(`pending_actions?chat_id=eq.${chatId}`).catch(() => {});
      return post("pending_actions", {
        chat_id: chatId,
        kind: "awaiting_objective_name",
        capture_id: captureId,
      });
    },

    async getPendingAction(chatId) {
      const rows = await get(`pending_actions?chat_id=eq.${chatId}`);
      return rows[0] || null;
    },

    async deletePendingAction(chatId) {
      return del(`pending_actions?chat_id=eq.${chatId}`);
    },
  };
}
