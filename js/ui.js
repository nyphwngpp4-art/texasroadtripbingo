// All rendering lives here; no game logic (that's claims.js/state.js).
// Increment 1 was deliberately ugly (player picker, flat item list, claim/
// confirm, derived status log); increment 2 adds offline behavior on top:
// pending-sync badges, reconcile-on-reconnect, reconcile-on-visible. Real UI
// polish is increment 3.

const AppUI = (() => {
  const root = document.getElementById('app');
  let tickInterval = null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function render() {
    if (!AppState.state.currentPlayerId) {
      renderPlayerPicker();
    } else {
      renderBoard();
    }
  }

  function renderPlayerPicker() {
    root.innerHTML = `
      <div class="p-6 flex flex-col gap-4">
        <h1 class="text-2xl font-bold text-center">Who's playing?</h1>
        <div id="player-list" class="grid grid-cols-2 gap-4"></div>
      </div>
    `;
    const list = document.getElementById('player-list');
    AppState.state.players.forEach((p) => {
      const btn = document.createElement('button');
      btn.className =
        'min-h-[88px] rounded-xl bg-sky-600 text-white text-xl font-semibold active:bg-sky-700';
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        AppState.setCurrentPlayer(p.id);
        render();
      });
      list.appendChild(btn);
    });
  }

  function renderBoard() {
    const me = AppState.currentPlayer();
    if (!me) {
      // Stored id no longer matches a known player — back to the picker.
      AppState.clearCurrentPlayer();
      render();
      return;
    }
    const score = AppState.scoreForPlayer(me.id);

    root.innerHTML = `
      <div class="p-4 flex flex-col gap-4 pb-24">
        <header class="flex items-center justify-between">
          <div>
            <div class="text-sm text-slate-500">Playing as</div>
            <div class="text-xl font-bold">${escapeHtml(me.name)}</div>
          </div>
          <div class="text-right">
            <div class="text-sm text-slate-500">Score</div>
            <div id="my-score" class="text-2xl font-bold text-emerald-600">${score}</div>
          </div>
          <button id="switch-player" class="text-sm text-slate-400 underline">switch</button>
        </header>

        <div id="sync-banner" class="hidden rounded-lg bg-slate-100 text-slate-500 text-sm text-center py-1"></div>

        <div id="incoming-claims" class="flex flex-col gap-2"></div>

        <h2 class="text-lg font-semibold">Spot something</h2>
        <div id="item-list" class="grid grid-cols-1 gap-2"></div>

        <h2 class="text-lg font-semibold mt-4">Recent claims</h2>
        <div id="claim-log" class="flex flex-col gap-2"></div>
      </div>
    `;

    document.getElementById('switch-player').addEventListener('click', () => {
      AppState.clearCurrentPlayer();
      render();
    });

    renderItemList();
    renderIncomingClaims();
    renderClaimLog();
    renderSyncBanner();

    if (!tickInterval) {
      tickInterval = setInterval(() => {
        renderIncomingClaims();
        renderClaimLog();
        renderSyncBanner();
        refreshScore();
        if (AppState.state.queue.length) AppState.flushQueue(); // defensive fallback flush
      }, 1000);
    }
  }

  function refreshScore() {
    const me = AppState.currentPlayer();
    const scoreEl = document.getElementById('my-score');
    if (me && scoreEl) scoreEl.textContent = AppState.scoreForPlayer(me.id);
  }

  function renderSyncBanner() {
    const banner = document.getElementById('sync-banner');
    if (!banner) return;
    const pending = AppState.state.queue.length;
    if (pending === 0) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    banner.textContent = `⏳ ${pending} update${pending === 1 ? '' : 's'} waiting to sync...`;
  }

  function renderItemList() {
    const container = document.getElementById('item-list');
    if (!container) return;
    container.innerHTML = '';
    AppState.state.items.forEach((item) => {
      const row = document.createElement('div');
      row.className =
        'flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3';
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="text-2xl">${item.emoji}</span>
          <div>
            <div class="font-medium">${escapeHtml(item.name)}</div>
            <div class="text-xs text-slate-500">${item.points} pts</div>
          </div>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className =
        'min-h-[60px] min-w-[88px] rounded-lg bg-amber-500 text-white font-bold active:bg-amber-600';
      btn.textContent = 'Claim';
      btn.addEventListener('click', () => {
        // Always instant: builds the row, applies it optimistically, queues
        // it, and kicks a background flush. Never blocks on the network.
        AppState.enqueueClaim(item.id, AppState.currentPlayer().id);
        renderIncomingClaims();
        renderClaimLog();
        renderSyncBanner();
      });
      row.appendChild(btn);
      container.appendChild(row);
    });
  }

  function renderIncomingClaims() {
    const container = document.getElementById('incoming-claims');
    if (!container) return;
    const me = AppState.currentPlayer();
    if (!me) return;
    const pending = AppState.state.claims.filter(
      (c) => c.claimer_id !== me.id && AppState.claimStatus(c) === 'pending'
    );
    container.innerHTML = '';
    pending.forEach((claim) => {
      const item = AppState.itemById(claim.item_id);
      const secondsLeft = Math.ceil(AppClaims.msRemaining(claim) / 1000);
      const banner = document.createElement('div');
      banner.className =
        'rounded-xl bg-amber-50 border-2 border-amber-400 p-3 flex items-center justify-between gap-3';
      banner.innerHTML = `
        <div>
          <div class="font-semibold">${escapeHtml(AppState.playerName(claim.claimer_id))} spotted ${
        item ? escapeHtml(item.name) : 'something'
      }</div>
          <div class="text-sm text-amber-700">${secondsLeft}s left to confirm</div>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className =
        'min-h-[60px] min-w-[88px] rounded-lg bg-emerald-600 text-white font-bold active:bg-emerald-700 disabled:opacity-50';
      btn.textContent = 'Confirm';
      btn.addEventListener('click', () => {
        AppState.enqueueConfirm(claim, me.id);
        renderIncomingClaims();
        renderClaimLog();
        renderSyncBanner();
        refreshScore();
      });
      banner.appendChild(btn);
      container.appendChild(banner);
    });
  }

  function renderClaimLog() {
    const container = document.getElementById('claim-log');
    if (!container) return;
    const me = AppState.currentPlayer();
    container.innerHTML = '';
    const sorted = [...AppState.state.claims].sort(
      (a, b) => new Date(b.synced_at) - new Date(a.synced_at)
    );
    const statusColor = {
      pending: 'text-amber-600',
      confirmed: 'text-emerald-600',
      expired: 'text-slate-400',
      denied: 'text-red-500',
      superseded: 'text-slate-400',
    };
    const statusLabel = {
      superseded: 'beaten to it',
    };
    sorted.slice(0, 20).forEach((claim) => {
      const item = AppState.itemById(claim.item_id);
      const status = AppState.claimStatus(claim);
      let label =
        status === 'pending'
          ? `${Math.ceil(AppClaims.msRemaining(claim) / 1000)}s left`
          : statusLabel[status] || status;
      if (claim._pendingSync) label = `⏳ ${label} (sending)`;
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between text-sm border-b border-slate-100 py-2';
      row.innerHTML = `
        <span>${item ? item.emoji : ''} ${item ? escapeHtml(item.name) : '?'} — ${escapeHtml(
        AppState.playerName(claim.claimer_id)
      )}</span>
        <span class="${statusColor[status] || ''} font-medium">${label}</span>
      `;
      container.appendChild(row);
    });
    if (me) refreshScore();
  }

  async function boot() {
    root.innerHTML = '<div class="p-6 text-center text-slate-400">Loading...</div>';
    await AppSupabase.measureServerTimeOffset();
    await Promise.all([AppState.loadPlayers(), AppState.loadItems(), AppState.loadClaims()]);
    render();

    // Anything left in the queue from a killed tab / previous offline
    // session (D3, ACCEPTANCE 2.3) gets a flush attempt right away.
    AppState.flushQueue();

    AppSupabase.subscribeToTable('claims', (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        AppState.upsertClaimLocal(payload.new);
        AppState.updateLastSeenSyncedAt([payload.new]);
        if (AppState.state.currentPlayerId) {
          renderIncomingClaims();
          renderClaimLog();
          renderSyncBanner();
        }
      }
    });

    // Realtime subscriptions miss everything during an outage (D3). Catch
    // back up whenever connectivity returns or the tab comes back to the
    // foreground (iOS kills WebSockets in backgrounded home-screen apps).
    window.addEventListener('online', async () => {
      await AppState.reconcile();
      if (AppState.state.currentPlayerId) {
        renderIncomingClaims();
        renderClaimLog();
        renderSyncBanner();
        refreshScore();
      }
    });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      await AppState.reconcile();
      if (AppState.state.currentPlayerId) {
        renderIncomingClaims();
        renderClaimLog();
        renderSyncBanner();
        refreshScore();
      }
    });
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => {
  AppUI.boot();
});
