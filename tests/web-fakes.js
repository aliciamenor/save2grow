// Fake Supabase client for web/js/feed.js's unit tests (spec 003, criteria 4-5). Mimics only the
// chained calls feed.js actually makes — not a general-purpose Supabase client fake.

export function makeFakeSupabase(fixture = {}) {
  const items = fixture.items ? fixture.items.map((i) => ({ ...i })) : [];
  const calls = { update: [] };

  const supabase = {
    from(table) {
      if (table !== "items") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          return {
            order(column, opts = {}) {
              const ascending = opts.ascending !== false;
              const sorted = [...items].sort((a, b) => {
                const diff = new Date(a[column]) - new Date(b[column]);
                return ascending ? diff : -diff;
              });
              return Promise.resolve({ data: sorted, error: null });
            },
          };
        },
        update(patch) {
          return {
            eq(column, value) {
              const item = items.find((i) => String(i[column]) === String(value));
              if (item) Object.assign(item, patch);
              calls.update.push({ column, value, patch });
              return Promise.resolve({ data: item ? [item] : [], error: null });
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, expiresIn) {
            return {
              data: {
                signedUrl: `https://fake.supabase.co/storage/v1/object/sign/${bucket}/${path}?expiresIn=${expiresIn}`,
              },
              error: null,
            };
          },
        };
      },
    },
  };

  return { supabase, items, calls };
}
