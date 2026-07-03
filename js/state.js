// In-memory app state, the offline queue (PLAN.md D3), and derive helpers.
//
// Claim status and score are always DERIVED from the rows (D2, D4) — never
// stored, never batch-updated. Every render recomputes them fresh, layered
// with D5 dedup via AppClaims.effectiveStatus.
//
// Offline queue (D3): every claim/confirm is written to localStorage first,
// always, and applied to local state optimistically. Sync is a background
// flush — it never blocks the UI and never throws at the caller. A claim's
// window doesn't truly start until the server stamps synced_at; the
// optimistic copy uses our best guess (nowServer()) so the UI has something
// to show immediately, and is silently overwritten the moment the real row
// arrives (self-delivered via realtime, or the next reconcile fetch).

const AppState = (() => {
  const PLAYER_STORAGE_KEY = 'trb_player_id';
  const QUEUE_STORAGE_KEY = 'trb_queue';

  const state = {
    players: [],
    items: [],
    claims: [],
    queue: loadQueueFromStorage(),
    lastSeenSyncedAt: null,
    currentPlayerId: localStorage.getItem(PLAYER_STORAGE_KEY) || null,
  };

  let flushing = false;

  // ---- player identity -----------------------------------------------

  function setCurrentPlayer(playerId) {
    state.currentPlayerId = playerId;
    localStorage.setItem(PLAYER_STORAGE_KEY, playerId);
  }

  function clearCurrentPlayer() {
    state.currentPlayerId = null;
    localStorage.removeItem(PLAYER_STORAGE_KEY);
  }

  function currentPlayer() {
    return state.players.find((p) => p.id === state.currentPlayerId) || null;
  }

  // ---- initial load -----------------------------------------------------

  async function loadPlayers() {
    const { data, error } = await AppSupabase.client
      .from('players')
      .select('id, name, role, team')
      .order('created_at');
    if (error) throw error;
    state.players = data;
    return data;
  }

  async function loadItems() {
    const { data, error } = await AppSupabase.client
      .from('items')
      .select('id, name, emoji, points, claim_rule, active')
      .eq('active', true)
      .order('points');
    if (error) throw error;
    state.items = data;
    return data;
  }

  async function loadClaims() {
    const { data, error } = await AppSupabase.client.from('claims').select('*').order('synced_at');
    if (error) throw error;
    state.claims = data;
    updateLastSeenSyncedAt(data);
    return data;
  }

  // ---- lookups & derived status ------------------------------------------

  function playerName(playerId) {
    return state.players.find((p) => p.id === playerId)?.name || '?';
  }

  function itemById(itemId) {
    return state.items.find((i) => i.id === itemId);
  }

  function claimStatus(claim) {
    return AppClaims.effectiveStatus(claim, state.claims, itemById(claim.item_id));
  }

  // D4: score is a fold over confirmed, non-superseded claims — nothing
  // stored anywhere.
  function scoreForPlayer(playerId) {
    return state.claims
      .filter((c) => c.claimer_id === playerId && claimStatus(c) === 'confirmed')
      .reduce((sum, c) => {
        const item = itemById(c.item_id);
        return sum + (item ? item.points : 0) + c.points_adjustment;
      }, 0);
  }

  function upsertClaimLocal(claim) {
    const idx = state.claims.findIndex((c) => c.id === claim.id);
    if (idx === -1) state.claims.push(claim);
    else state.claims[idx] = claim;
  }

  function updateLastSeenSyncedAt(rows) {
    rows.forEach((r) => {
      if (!state.lastSeenSyncedAt || r.synced_at > state.lastSeenSyncedAt) {
        state.lastSeenSyncedAt = r.synced_at;
      }
    });
  }

  // ---- offline queue (D3) ------------------------------------------------

  function loadQueueFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveQueue() {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(state.queue));
  }

  function isQueued(claimId) {
    return state.queue.some(
      (e) =>
        (e.type === 'claim' && e.payload.id === claimId) ||
        (e.type === 'confirm' && e.payload.claimId === claimId)
    );
  }

  function enqueueClaim(itemId, playerId) {
    const row = AppClaims.buildClaimRow(itemId, playerId);
    upsertClaimLocal({
      ...row,
      synced_at: new Date(AppSupabase.nowServer()).toISOString(),
      confirmer_id: null,
      confirmed_at: null,
      confirm_synced_at: null,
      status_override: null,
      points_adjustment: 0,
      admin_note: null,
      _pendingSync: true,
    });
    state.queue.push({ id: row.id, type: 'claim', payload: row });
    saveQueue();
    flushQueue();
    return row;
  }

  function enqueueConfirm(claim, playerId) {
    if (claim.claimer_id === playerId) return; // self-confirm — UI shouldn't offer this, belt & suspenders
    if (isQueued(claim.id)) return; // already sent or mid-flush
    const confirmedAt = new Date().toISOString();
    upsertClaimLocal({
      ...claim,
      confirmer_id: playerId,
      confirmed_at: confirmedAt,
      confirm_synced_at: new Date(AppSupabase.nowServer()).toISOString(),
      _pendingSync: true,
    });
    state.queue.push({
      id: `confirm-${claim.id}`,
      type: 'confirm',
      payload: { claimId: claim.id, confirmerId: playerId, confirmedAt },
    });
    saveQueue();
    flushQueue();
  }

  function dequeue(entryId) {
    state.queue = state.queue.filter((e) => e.id !== entryId);
    saveQueue();
  }

  async function sendQueueEntry(entry) {
    const error =
      entry.type === 'claim'
        ? await AppClaims.insertClaimRow(entry.payload)
        : await AppClaims.updateConfirmRow(
            entry.payload.claimId,
            entry.payload.confirmerId,
            entry.payload.confirmedAt
          );
    if (!error) return { ok: true };
    // A PostgREST/Postgres error that actually reached the server carries a
    // `code`; anything else (TypeError, "Failed to fetch", ...) means we're
    // still offline — stop the flush rather than spin on every entry.
    return { ok: false, offline: !error.code, error };
  }

  // Claims flush before confirms (D3): a queued confirm's target claim
  // might also be sitting in this same queue after an all-offline round.
  async function flushQueue() {
    if (flushing) return;
    flushing = true;
    try {
      const ordered = [
        ...state.queue.filter((e) => e.type === 'claim'),
        ...state.queue.filter((e) => e.type === 'confirm'),
      ];
      for (const entry of ordered) {
        if (!state.queue.find((e) => e.id === entry.id)) continue; // dequeued mid-loop
        const result = await sendQueueEntry(entry);
        if (!result.ok && result.offline) break; // stop; retry next tick/reconnect
        if (!result.ok) console.warn('Dropping unsendable queue entry', entry, result.error);
        dequeue(entry.id);
      }
    } finally {
      flushing = false;
    }
  }

  // ---- reconciliation (D3) -----------------------------------------------
  // Realtime subscriptions miss everything that happens during an outage.
  // Call this on reconnect and on visibilitychange→visible (iOS kills
  // WebSockets in backgrounded home-screen apps) to catch back up.
  async function reconcile() {
    // Flush first: push anything we owe so this fetch can see our own rows
    // too, not just everyone else's (matters when realtime itself is the
    // thing that's down, e.g. iOS killing the socket in the background).
    await flushQueue();
    const cursor = state.lastSeenSyncedAt || '1970-01-01T00:00:00Z';
    const { data, error } = await AppSupabase.client
      .from('claims')
      .select('*')
      .gt('synced_at', cursor)
      .order('synced_at');
    if (error || !data) return;
    data.forEach((row) => upsertClaimLocal(row));
    updateLastSeenSyncedAt(data);
  }

  return {
    state,
    setCurrentPlayer,
    clearCurrentPlayer,
    currentPlayer,
    loadPlayers,
    loadItems,
    loadClaims,
    upsertClaimLocal,
    updateLastSeenSyncedAt,
    playerName,
    itemById,
    claimStatus,
    scoreForPlayer,
    isQueued,
    enqueueClaim,
    enqueueConfirm,
    flushQueue,
    reconcile,
  };
})();
