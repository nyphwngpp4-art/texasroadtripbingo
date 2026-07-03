# PLAN

Written by Fable after pressure-testing the offline sync design and confirmation-window
mechanic (see "Design decisions" below). Sonnet implements this incrementally; Fable
reviews each increment against ACCEPTANCE.md. No scope beyond this file without asking.

**Ship line for the Chandler→Lubbock drive: Increments 0–3.** Increments 4–6 are
mid-trip builds (the trip is a month long; the app can grow on the road).

---

## Design decisions (and why)

These resolve the two danger zones called out in CLAUDE.md. They are load-bearing —
do not "simplify" them away during implementation.

### D1. Confirmation window anchors to server time, not claim time

All four devices ride in the same car, so they lose cell signal *together*. If the 60s
window ran from when a claim was *made*, every claim made in a dead zone would expire
before anyone could see it. Instead:

- Each claim carries two timestamps: `claimed_at` (client clock — display only,
  "spotted at 10:20") and `synced_at` (set by Postgres when the row lands — game logic).
- The confirmation window is `synced_at + 60s`. A confirmation is valid iff its own
  server timestamp `confirm_synced_at <= synced_at + 75s` (60s window + 15s grace for
  network lag).
- This makes the all-offline case work with zero special-case code: the family agrees
  verbally in the car; when signal returns, the queued claim syncs, pops up on the other
  devices, and someone has a fresh 60s to tap confirm.
- Constants: `CLAIM_WINDOW_MS = 60_000`, `CONFIRM_GRACE_MS = 15_000` (one place in
  `js/claims.js`).

### D2. Claim status is derived, never batch-updated

There is no cron, no edge function, no "expiry job." A claim's status is computed
client-side from its row:

1. `status_override = 'denied'` → **denied** (admin action)
2. `status_override = 'confirmed'` → **confirmed** (admin revive)
3. `confirmer_id` set and `confirm_synced_at <= synced_at + 75s` → **confirmed**
4. otherwise, if `now_server < synced_at + 60s` → **pending** (countdown running)
5. otherwise → **expired**

`now_server` = device clock + a server-time offset measured once per session (compare
`Date.now()` against a server timestamp on connect). Never trust raw device clocks for
game logic; four traveling devices will disagree, and the route crosses MST→CST.

### D3. Offline queue: client UUIDs, idempotent upserts, reconcile on every wake

Queuing while offline is the easy half. The failure modes are on *reconnect*:

- Every claim and confirmation gets a **client-generated UUID** and goes into a
  `localStorage` queue first, always. The UI updates optimistically with a
  "pending sync" badge. Sync is a background flush, never a blocking call.
- Flush = idempotent insert (`upsert` with `ignoreDuplicates` on the client UUID pk).
  A retry after a half-failed flush can never double-score.
- **Realtime subscriptions miss everything during an outage.** On every reconnect AND
  on every `visibilitychange` → visible (iOS kills WebSockets in backgrounded
  home-screen apps), run a reconciliation fetch: all claims with
  `synced_at > last_seen_synced_at`, plus re-fetch of any local pending claims by id.
  This refetch-on-wake is the single most load-bearing piece of the sync design.
- Queue flush order: claims before confirmations (a queued confirm references a queued
  claim after an all-offline round).
- A ~20-line `sw.js` caches the app shell (cache-first for same-origin static files) so
  the app still *opens* if iOS killed the tab in a dead zone. No build step.

### D4. Scoreboard is 100% derived

No stored totals anywhere. Score = fold over the claims table (joined to items and
days) client-side. Nothing to get out of sync, nothing to reconcile.

- `effective_points(claim) = item.points + claim.points_adjustment`
- Only **confirmed** claims score.
- Free-for-all day: totals per player. Team day: totals summed by `players.team`.
- `game_day` is the device-local calendar date at claim time (all devices share a car,
  so they agree in practice; a midnight-boundary dispute is a parent-admin problem, not
  a code problem).

### D5. Duplicate offline claims: first synced wins

Two players claim the same `first_per_day` item in a dead zone; both sync later. The
claim with the earlier `synced_at` is the live one; the app shows the loser as
"beaten to it" (it never enters pending state). Parent admin can override via
`status_override`. For `per_player_per_day` items duplicates by *different* players are
both legitimate; duplicates by the *same* player same day are blocked in the UI and
ignored in scoring (first synced counts).

### D6. Honest security posture

Shared publishable key, no auth → RLS cannot distinguish players. The database enforces
**shape**, not identity: no deletes, no self-confirmation (CHECK constraint), no
overwriting an existing confirmation (trigger), server-owned timestamps (column grants +
trigger), point bounds (CHECK). Which player a device claims to be is the honor system —
correct for a family of four, documented so nobody mistakes it for real security.

### D7. One deviation from CLAUDE.md: a fourth (tiny) table

The per-day game mode (free-for-all vs girls-vs-parents) must persist and sync.
Denormalizing mode onto every claim is worse than bending "3 tables max" with
`days(game_day, mode, set_by)` — two meaningful columns. Flagged here as a deliberate
deviation; veto it and Sonnet should denormalize `mode` onto claims instead.

---

## Architecture

```
┌────────────┐   claim/confirm (upsert, idempotent)   ┌───────────────┐
│ 4 devices  │ ─────────────────────────────────────▶ │   Supabase    │
│ (PWA tabs) │ ◀───────────────────────────────────── │  Postgres +   │
│            │     realtime INSERT/UPDATE events       │   Realtime    │
│ localStorage│                                        └───────────────┘
│ queue +    │    reconcile fetch on reconnect/wake
│ last_seen  │ ─────────────────────────────────────▶
└────────────┘
```

- Static site on Cloudflare Pages. Vanilla HTML/CSS/JS, Tailwind via CDN, no build step.
- One shared "trip room" = the whole database (single family, single trip).
- Device identity: on first load, pick your player from the four seeded players; stored
  in `localStorage`. Parents' player rows (`role='parent'`) unlock the admin panel.

## Supabase schema

Full paste-ready SQL lives in `supabase/schema.sql` (tables, constraints, triggers,
grants, RLS, realtime publication) and `supabase/seed.sql` (4 placeholder players —
**edit the first names before running** — plus the 30 starter items from
`data/items.json`). Apply order: schema.sql, then seed.sql, in the Supabase SQL editor.

Tables (see the SQL for the authoritative definitions):

- **players** — id, name, role ('kid'|'parent'), team ('girls'|'parents'), created_at
- **items** — id, name, emoji, points (1–100), claim_rule
  ('per_player_per_day' | 'first_per_day' | 'once_per_trip'), active, created_at
- **claims** — id (client uuid), item_id, claimer_id, claimed_at (client),
  synced_at (server), game_day, confirmer_id, confirmed_at (client),
  confirm_synced_at (server, trigger-set), status_override, points_adjustment,
  admin_note. CHECK: no self-confirm. Trigger: server owns confirm_synced_at,
  confirmations are write-once, core columns immutable after insert.
- **days** — game_day (pk), mode ('ffa'|'teams'), set_by

## File map

```
index.html            entry — screens: player picker, board, scoreboard, admin
sw.js                 app-shell cache (increment 3)
js/config.js          Supabase URL + publishable key (exists)
js/supabase.js        client init, realtime subscribe, server-time offset,
                      reconcile fetch, connection-state watcher
js/state.js           in-memory store, localStorage queue + flush, last_seen cursor,
                      derived claim status + scoreboard (D2, D4 live here)
js/claims.js          claim/confirm actions, window math, duplicate rules (D1, D5)
js/ui.js              all rendering; no game logic
data/items.json       starter items — source of truth for seed.sql
supabase/schema.sql   paste into SQL editor (tables, RLS, grants, triggers, realtime)
supabase/seed.sql     paste second (players + items)
```

## Game rules (defaults chosen — easy to change before implementation)

- **Items**: 30 starter items in `data/items.json`, mixed rules: commons (5 pts) and
  uncommons (10 pts) claimable once per player per day; rares (25 pts) first-claimer-
  only per day; epics (50 pts — state-line signs, Buc-ee's) once per trip.
- **Teams**: team score = sum of both members' confirmed points that day. Daily winner
  banner on the scoreboard; trip view shows team-day win count alongside individual
  trip totals. (No handicap multiplier in v1 — add later if parents dominate.)
- **Admin (day one)**: revive an expired claim / deny a contested one
  (`status_override`), adjust points on a claim (`points_adjustment` + `admin_note`).
  Item add/edit/retire is increment 6, mid-trip.

## Build sequence

Each increment is a separate commit; stop when its ACCEPTANCE.md criteria pass.

- **Increment 0 — Schema applied.** User pastes `schema.sql` + `seed.sql` (with real
  first names) into the Supabase SQL editor. Smoke-test: insert a claim in the table
  editor, see it arrive in a second browser tab via a 10-line test page or console.
- **Increment 1 — Two-device claim/confirm proof-of-concept.** Ugly on purpose: player
  picker, flat item list, Claim button, incoming-claim banner with live 60s countdown,
  Confirm button, derived status list. Realtime insert/update wiring, server-time
  offset, D1/D2 logic complete. No offline handling yet beyond not crashing.
- **Increment 2 — Offline queue + reconciliation.** localStorage queue, idempotent
  flush, claims-before-confirms ordering, reconcile fetch on reconnect and
  visibilitychange, pending-sync badges. This is the increment the airplane-mode
  acceptance tests attack.
- **Increment 3 — Real UI + scoreboard + shell cache.** Tailwind board with big touch
  targets (min 44px, aim bigger — 9-year-old in a moving car), emoji-forward item
  cards, per-day and whole-trip scoreboard views, confirm banner polish, `sw.js`,
  add-to-homescreen meta tags. **← ship line for the drive**
- **Increment 4 — Team days.** `days` table wiring, parent picks today's mode, team
  totals + daily winner banner.
- **Increment 5 — Parent admin panel.** Revive/deny claims, adjust points with note.
  Visible only when the selected player has `role='parent'`.
- **Increment 6 — Kid-friendly item editor.** Add/edit/retire items (name, emoji,
  points, rule) from any device; parents can retire from admin too.

## Out of scope for v1

Story builder / PDF keepsake (v2 per CLAUDE.md), auth of any kind, push notifications,
sounds, multi-trip support, handicap multipliers.
