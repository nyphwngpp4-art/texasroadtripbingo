// Claim/confirm row-building + network calls, the derived-status state
// machine (PLAN.md D1/D2), and duplicate-claim resolution (D5). No cron job
// or edge function ever flips a claim's status — every device computes it
// fresh from synced_at / confirm_synced_at on each render, using
// AppSupabase.nowServer() instead of the device clock.
//
// Network calls here never throw — they return a Supabase-style error object
// (or null) so the caller (AppState's offline queue) can tell a connectivity
// failure apart from a real rejection without try/catch plumbing.

const AppClaims = (() => {
  const CLAIM_WINDOW_MS = 60_000;
  const CONFIRM_GRACE_MS = 15_000;

  function localGameDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // D2: derive status from the row alone. Admin overrides win outright; a
  // valid confirmation beats a blown deadline; otherwise it's pending vs
  // expired. Doesn't know about sibling claims — see effectiveStatus for D5.
  function claimStatus(claim) {
    if (claim.status_override === 'denied') return 'denied';
    if (claim.status_override === 'confirmed') return 'confirmed';

    if (claim.confirmer_id && claim.confirm_synced_at) {
      const confirmedInTime =
        new Date(claim.confirm_synced_at).getTime() <=
        new Date(claim.synced_at).getTime() + CLAIM_WINDOW_MS + CONFIRM_GRACE_MS;
      if (confirmedInTime) return 'confirmed';
    }

    const deadline = new Date(claim.synced_at).getTime() + CLAIM_WINDOW_MS;
    return AppSupabase.nowServer() < deadline ? 'pending' : 'expired';
  }

  function msRemaining(claim) {
    const deadline = new Date(claim.synced_at).getTime() + CLAIM_WINDOW_MS;
    return Math.max(0, deadline - AppSupabase.nowServer());
  }

  // D5: what scope makes two claims "duplicates" depends on the item's rule.
  function groupKey(claim, item) {
    switch (item.claim_rule) {
      case 'first_per_day':
        return `${claim.item_id}|${claim.game_day}`;
      case 'once_per_trip':
        return `${claim.item_id}`;
      case 'per_player_per_day':
      default:
        return `${claim.item_id}|${claim.game_day}|${claim.claimer_id}`;
    }
  }

  // D5: within a group, the earliest-synced claim is canonical. Every other
  // claim in the group is permanently superseded — "beaten to it," never
  // enters the pending window, never scores, regardless of what happens to
  // the canonical claim afterwards (that's the honest tradeoff D5 accepts;
  // admin can override via status_override).
  function isSuperseded(claim, siblingClaims, item) {
    if (!item) return false;
    const key = groupKey(claim, item);
    const group = siblingClaims.filter(
      (c) => c.item_id === claim.item_id && groupKey(c, item) === key
    );
    if (group.length <= 1) return false;
    const earliest = group.reduce((min, c) =>
      new Date(c.synced_at).getTime() < new Date(min.synced_at).getTime() ? c : min
    );
    return earliest.id !== claim.id;
  }

  // The status any renderer/scorer should actually use: D5 dedup layered
  // on top of D2, except an admin override always wins outright.
  function effectiveStatus(claim, siblingClaims, item) {
    if (claim.status_override) return claimStatus(claim);
    if (isSuperseded(claim, siblingClaims, item)) return 'superseded';
    return claimStatus(claim);
  }

  function buildClaimRow(itemId, playerId) {
    return {
      id: crypto.randomUUID(),
      item_id: itemId,
      claimer_id: playerId,
      claimed_at: new Date().toISOString(),
      game_day: localGameDay(),
    };
  }

  // Idempotent by design: retrying an already-inserted row (same client
  // UUID pk) is a no-op, never a duplicate (D3 — safe to blind-retry).
  async function insertClaimRow(row) {
    try {
      const { error } = await AppSupabase.client
        .from('claims')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      return error || null;
    } catch (err) {
      return err;
    }
  }

  // Also safe to blind-retry: the claims_update_guard trigger no-ops an
  // update that repeats the same confirmer_id (see supabase/schema.sql).
  async function updateConfirmRow(claimId, confirmerId, confirmedAt) {
    try {
      const { error } = await AppSupabase.client
        .from('claims')
        .update({ confirmer_id: confirmerId, confirmed_at: confirmedAt })
        .eq('id', claimId);
      return error || null;
    } catch (err) {
      return err;
    }
  }

  return {
    CLAIM_WINDOW_MS,
    CONFIRM_GRACE_MS,
    localGameDay,
    claimStatus,
    msRemaining,
    groupKey,
    isSuperseded,
    effectiveStatus,
    buildClaimRow,
    insertClaimRow,
    updateConfirmRow,
  };
})();
