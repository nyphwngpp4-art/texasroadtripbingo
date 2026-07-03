// All rendering lives here; no game logic (that's claims.js/state.js).
// Increment 3: real UI — tabs (Board / Scoreboard), the incoming-claims
// banner is reachable from either tab, item cards show why a claim is
// blocked (D5), emoji-forward, every tappable control is >= 44px (claim/
// confirm buttons >= 60px tall) per ACCEPTANCE 3.1.

const AppUI = (() => {
  const root = document.getElementById('app');
  let tickInterval = null;
  let activeTab = 'board'; // 'board' | 'scoreboard'
  let scoreScope = 'today'; // 'today' | 'trip'

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function tierColor(points) {
    if (points >= 50) return 'text-purple-600';
    if (points >= 25) return 'text-rose-600';
    if (points >= 10) return 'text-amber-600';
    return 'text-slate-500';
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
        activeTab = 'board';
        render();
      });
      list.appendChild(btn);
    });
  }

  // ---- app shell: header + persistent confirm banner + tabs ---------------

  function renderBoard() {
    const me = AppState.currentPlayer();
    if (!me) {
      AppState.clearCurrentPlayer();
      render();
      return;
    }
    const score = AppState.scoreForPlayer(me.id);

    root.innerHTML = `
      <div class="flex flex-col min-h-screen">
        <header class="flex items-center justify-between p-4 pb-2">
          <div>
            <div class="text-sm text-slate-500">Playing as</div>
            <div class="text-xl font-bold">${escapeHtml(me.name)}</div>
          </div>
          <div class="text-right">
            <div class="text-sm text-slate-500">Score</div>
            <div id="my-score" class="text-2xl font-bold text-emerald-600">${score}</div>
          </div>
          <button id="switch-player" class="min-h-[44px] px-2 flex items-center text-sm text-slate-400 underline">switch</button>
        </header>

        <div id="sync-banner" class="hidden mx-4 rounded-lg bg-slate-100 text-slate-500 text-sm text-center py-1"></div>
        <div id="incoming-claims" class="flex flex-col gap-2 mx-4 mt-2"></div>

        <nav id="tabs" class="flex mt-3 border-b border-slate-200"></nav>
        <div id="tab-content" class="flex-1 p-4 pb-24"></div>
      </div>
    `;

    document.getElementById('switch-player').addEventListener('click', () => {
      AppState.clearCurrentPlayer();
      render();
    });

    renderTabs();
    renderTabContent();
    renderIncomingClaims();
    renderSyncBanner();

    if (!tickInterval) {
      tickInterval = setInterval(() => {
        renderIncomingClaims();
        renderSyncBanner();
        refreshScore();
        if (activeTab === 'board') {
          renderItemList();
          renderClaimLog();
        }
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

  // Reachable from any screen (ACCEPTANCE 3.3): rendered outside the tab
  // switch, so it survives a Board <-> Scoreboard flip untouched.
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
        if (activeTab === 'board') {
          renderItemList();
          renderClaimLog();
        }
        renderSyncBanner();
        refreshScore();
      });
      banner.appendChild(btn);
      container.appendChild(banner);
    });
  }

  // ---- tabs -----------------------------------------------------------

  function renderTabs() {
    const nav = document.getElementById('tabs');
    if (!nav) return;
    const tabClass = (tab) =>
      `flex-1 min-h-[48px] font-semibold border-b-2 ${
        activeTab === tab ? 'border-sky-600 text-sky-600' : 'border-transparent text-slate-400'
      }`;
    nav.innerHTML = `
      <button id="tab-board" class="${tabClass('board')}">Board</button>
      <button id="tab-scoreboard" class="${tabClass('scoreboard')}">Scoreboard</button>
    `;
    document.getElementById('tab-board').addEventListener('click', () => {
      activeTab = 'board';
      renderTabs();
      renderTabContent();
    });
    document.getElementById('tab-scoreboard').addEventListener('click', () => {
      activeTab = 'scoreboard';
      renderTabs();
      renderTabContent();
    });
  }

  function renderTabContent() {
    if (activeTab === 'board') renderBoardTab();
    else renderScoreboardTab();
  }

  function renderBoardTab() {
    const container = document.getElementById('tab-content');
    if (!container) return;
    container.innerHTML = `
      <h2 class="text-lg font-semibold mb-2">Spot something</h2>
      <div id="item-list" class="grid grid-cols-1 gap-2"></div>
      <h2 class="text-lg font-semibold mt-4 mb-2">Recent claims</h2>
      <div id="claim-log" class="flex flex-col gap-2"></div>
    `;
    renderItemList();
    renderClaimLog();
  }

  // Why a given item is blocked from a new claim right now (ACCEPTANCE 3.5).
  function blockedReason(item, blocking, me) {
    if (blocking._pendingSync) return 'Sending…';
    const status = AppState.claimStatus(blocking);
    if (item.claim_rule === 'per_player_per_day') {
      const map = {
        confirmed: `✓ Claimed today (+${AppState.effectivePoints(blocking)})`,
        pending: 'Waiting to confirm…',
        expired: 'Missed it today',
        denied: 'Denied today',
      };
      return map[status] || 'Claimed today';
    }
    const who = blocking.claimer_id === me.id ? 'You' : AppState.playerName(blocking.claimer_id);
    const scope = item.claim_rule === 'once_per_trip' ? 'this trip' : 'today';
    if (status === 'confirmed') return `${who} got it ${scope}`;
    if (status === 'pending') return `${who} is confirming…`;
    return `${who} called it ${scope}`; // expired/denied still holds the slot (D5)
  }

  function renderItemList() {
    const container = document.getElementById('item-list');
    if (!container) return;
    const me = AppState.currentPlayer();
    if (!me) return;
    container.innerHTML = '';
    AppState.state.items.forEach((item) => {
      const blocking = AppState.blockingClaimForItem(item, me.id);
      const card = document.createElement('div');
      card.className = `flex items-center justify-between gap-3 rounded-xl border p-3 ${
        blocking ? 'border-slate-100 bg-slate-50' : 'border-slate-200'
      }`;
      card.innerHTML = `
        <div class="flex items-center gap-3 ${blocking ? 'opacity-60' : ''}">
          <span class="text-4xl leading-none">${item.emoji}</span>
          <div>
            <div class="font-medium">${escapeHtml(item.name)}</div>
            <div class="text-xs font-semibold ${tierColor(item.points)}">${item.points} pts</div>
            ${
              blocking
                ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(
                    blockedReason(item, blocking, me)
                  )}</div>`
                : ''
            }
          </div>
        </div>
      `;
      if (blocking) {
        const badge = document.createElement('div');
        badge.className =
          'min-h-[60px] min-w-[88px] flex items-center justify-center text-slate-300 text-2xl';
        badge.textContent = '—';
        card.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className =
          'min-h-[60px] min-w-[88px] rounded-lg bg-amber-500 text-white font-bold active:bg-amber-600';
        btn.textContent = 'Claim';
        btn.addEventListener('click', () => {
          AppState.enqueueClaim(item.id, me.id);
          renderItemList();
          renderIncomingClaims();
          renderClaimLog();
          renderSyncBanner();
        });
        card.appendChild(btn);
      }
      container.appendChild(card);
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
    const statusLabel = { superseded: 'beaten to it' };
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

  // ---- scoreboard tab (ACCEPTANCE 3.4) ---------------------------------

  function renderScoreboardTab() {
    const container = document.getElementById('tab-content');
    if (!container) return;
    const me = AppState.currentPlayer();
    const scopeBtnClass = (scope) =>
      `flex-1 min-h-[44px] rounded-lg font-semibold ${
        scoreScope === scope ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
      }`;
    container.innerHTML = `
      <div class="flex gap-2 mb-4">
        <button id="scope-today" class="${scopeBtnClass('today')}">Today</button>
        <button id="scope-trip" class="${scopeBtnClass('trip')}">Whole Trip</button>
      </div>
      <div id="scoreboard-list" class="flex flex-col gap-2"></div>
    `;
    document.getElementById('scope-today').addEventListener('click', () => {
      scoreScope = 'today';
      renderScoreboardTab();
    });
    document.getElementById('scope-trip').addEventListener('click', () => {
      scoreScope = 'trip';
      renderScoreboardTab();
    });

    const rows = AppState.scoreboard({ onlyToday: scoreScope === 'today' });
    const list = document.getElementById('scoreboard-list');
    rows.forEach(({ player, score }, i) => {
      const isMe = player.id === me.id;
      const row = document.createElement('div');
      row.className = `flex items-center justify-between rounded-xl p-3 ${
        isMe ? 'bg-sky-50 border-2 border-sky-300' : 'bg-slate-50'
      }`;
      row.innerHTML = `
        <span class="font-semibold">${i === 0 && score > 0 ? '🏆 ' : ''}${escapeHtml(player.name)}${
        isMe ? ' (you)' : ''
      }</span>
        <span class="text-xl font-bold text-emerald-600">${score}</span>
      `;
      list.appendChild(row);
    });
  }

  // ---- boot -----------------------------------------------------------

  function renderBootError(err) {
    console.error('Failed to start', err);
    root.innerHTML = `
      <div class="p-6 flex flex-col items-center gap-4 text-center">
        <h1 class="text-xl font-bold text-red-600">Couldn't load the game</h1>
        <p class="text-slate-500 text-sm">${escapeHtml(err && err.message ? err.message : String(err))}</p>
        <button id="retry-boot" class="min-h-[48px] px-6 rounded-lg bg-sky-600 text-white font-semibold">Try again</button>
      </div>
    `;
    document.getElementById('retry-boot').addEventListener('click', boot);
  }

  async function boot() {
    root.innerHTML = '<div class="p-6 text-center text-slate-400">Loading...</div>';
    try {
      await AppSupabase.measureServerTimeOffset();
      await Promise.all([AppState.loadPlayers(), AppState.loadItems(), AppState.loadClaims()]);
    } catch (err) {
      renderBootError(err);
      return;
    }
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
          renderSyncBanner();
          if (activeTab === 'board') {
            renderItemList();
            renderClaimLog();
          } else {
            renderScoreboardTab();
          }
        }
      }
    });

    // Realtime subscriptions miss everything during an outage (D3). Catch
    // back up whenever connectivity returns or the tab comes back to the
    // foreground (iOS kills WebSockets in backgrounded home-screen apps).
    const catchUp = async () => {
      await AppState.reconcile();
      if (!AppState.state.currentPlayerId) return;
      renderIncomingClaims();
      renderSyncBanner();
      refreshScore();
      if (activeTab === 'board') {
        renderItemList();
        renderClaimLog();
      } else {
        renderScoreboardTab();
      }
    };
    window.addEventListener('online', catchUp);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') catchUp();
    });
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => {
  AppUI.boot();
});
