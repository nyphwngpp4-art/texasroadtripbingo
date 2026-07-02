// In-memory app state plus fetch/derive helpers.
//
// Claim status and score are always DERIVED from the rows (PLAN.md D2, D4) —
// never stored, never batch-updated. Every render recomputes them fresh.

const AppState = (() => {
  const PLAYER_STORAGE_KEY = 'trb_player_id';

  const state = {
    players: [],
    items: [],
    claims: [],
    currentPlayerId: localStorage.getItem(PLAYER_STORAGE_KEY) || null,
  };

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
    return data;
  }

  function upsertClaimLocal(claim) {
    const idx = state.claims.findIndex((c) => c.id === claim.id);
    if (idx === -1) state.claims.push(claim);
    else state.claims[idx] = claim;
  }

  function playerName(playerId) {
    return state.players.find((p) => p.id === playerId)?.name || '?';
  }

  function itemById(itemId) {
    return state.items.find((i) => i.id === itemId);
  }

  // D4: score is a fold over confirmed claims, nothing stored anywhere.
  function scoreForPlayer(playerId) {
    return state.claims
      .filter((c) => c.claimer_id === playerId && AppClaims.claimStatus(c) === 'confirmed')
      .reduce((sum, c) => {
        const item = itemById(c.item_id);
        return sum + (item ? item.points : 0) + c.points_adjustment;
      }, 0);
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
    playerName,
    itemById,
    scoreForPlayer,
  };
})();
