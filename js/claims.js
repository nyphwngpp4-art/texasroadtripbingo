// Claim/confirm actions plus the derived-status state machine (PLAN.md
// D1/D2). No cron job or edge function ever flips a claim's status — every
// device computes it fresh from synced_at / confirm_synced_at on each render,
// using AppSupabase.nowServer() instead of the device clock.

const AppClaims = (() => {
  const CLAIM_WINDOW_MS = 60_000;
  const CONFIRM_GRACE_MS = 15_000;

  function localGameDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // D2: derive status from the row. Admin overrides win outright; a valid
  // confirmation beats a blown deadline; otherwise it's pending vs expired.
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

  async function claimItem(itemId, playerId) {
    const claim = {
      id: crypto.randomUUID(),
      item_id: itemId,
      claimer_id: playerId,
      claimed_at: new Date().toISOString(),
      game_day: localGameDay(),
    };
    const { error } = await AppSupabase.client.from('claims').insert(claim);
    if (error) throw error;
    return claim;
  }

  async function confirmClaim(claim, playerId) {
    if (claim.claimer_id === playerId) {
      throw new Error('You cannot confirm your own claim');
    }
    const { error } = await AppSupabase.client
      .from('claims')
      .update({ confirmer_id: playerId, confirmed_at: new Date().toISOString() })
      .eq('id', claim.id);
    if (error) throw error;
  }

  return {
    CLAIM_WINDOW_MS,
    CONFIRM_GRACE_MS,
    localGameDay,
    claimStatus,
    msRemaining,
    claimItem,
    confirmClaim,
  };
})();
