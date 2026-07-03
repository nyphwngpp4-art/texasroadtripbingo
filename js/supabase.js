// Supabase client singleton, realtime subscription helper, and server-time
// offset (PLAN.md D1: the confirmation window is anchored to Postgres's
// clock, not the device's — four devices riding in one car will disagree
// with each other and cross a timezone line on this trip).
//
// The offset is measured once per session by reading the standard HTTP
// `Date` response header off a cheap REST call. No RPC function needed.

const AppSupabase = (() => {
  const client = window.supabase.createClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.publishableKey
  );

  let serverOffsetMs = 0; // serverNow - Date.now(); see measureServerTimeOffset()

  async function measureServerTimeOffset() {
    const before = Date.now();
    const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/items?select=id&limit=1`, {
      headers: { apikey: SUPABASE_CONFIG.publishableKey },
    });
    const after = Date.now();
    const serverDateHeader = res.headers.get('date');
    if (!serverDateHeader) return; // offset stays 0 — degrades gracefully
    const serverTime = new Date(serverDateHeader).getTime();
    const roundTrip = after - before;
    // The Date header is stamped when the response leaves the server; assume
    // it left roughly at the midpoint of the round trip. A few hundred ms of
    // error doesn't matter against a 60s window with a 15s grace.
    serverOffsetMs = serverTime - (before + roundTrip / 2);
  }

  function nowServer() {
    return Date.now() + serverOffsetMs;
  }

  function subscribeToTable(table, callback) {
    return client
      .channel(`${table}-sync`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
      .subscribe();
  }

  return { client, measureServerTimeOffset, nowServer, subscribeToTable };
})();
