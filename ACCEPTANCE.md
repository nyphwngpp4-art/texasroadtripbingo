# ACCEPTANCE CRITERIA

Every item is a concrete pass/fail check. "Two devices" below means two separate
browser sessions (different machines or one machine + one phone) — private windows
count. Timings measured by watching the screen, not by instrumentation.

## Increment 0 — Schema applied

- [ ] 0.1 `schema.sql` then `seed.sql` run in the Supabase SQL editor with zero errors.
- [ ] 0.2 Table editor shows 4 players (2 kid / 2 parent, real first names), 30 active
      items, 0 claims, 0 days.
- [ ] 0.3 Inserting a claims row from the table editor appears in a subscribed browser
      tab (console log is fine) within 2s.
- [ ] 0.4 An UPDATE to claims that changes `item_id`, `claimer_id`, or `synced_at` is
      rejected (trigger).
- [ ] 0.5 An UPDATE that sets `confirmer_id` equal to the claim's `claimer_id` is
      rejected (CHECK).
- [ ] 0.6 A second UPDATE that changes an already-set `confirmer_id` is rejected
      (trigger: confirmations are write-once).
- [ ] 0.7 `confirm_synced_at` is set by the server when `confirmer_id` is set, even if
      the client supplied a bogus value.
- [ ] 0.8 DELETE on any table with the publishable key fails.

## Increment 1 — Two-device claim/confirm proof-of-concept

- [ ] 1.1 Device A claims an item; it appears on device B with claimer name, item name,
      and a live countdown within 2s on good signal.
- [ ] 1.2 Device B taps Confirm inside the window → both devices show the claim
      confirmed and the claimer's score increases by the item's points within 2s.
- [ ] 1.3 Nobody confirms for 60s → both devices show the claim expired; score
      unchanged. No page reload needed on either device.
- [ ] 1.4 Device A cannot confirm its own claim: no confirm control is shown for it,
      and a forged update is rejected by the database (0.5 double-checks this).
- [ ] 1.5 The countdown on device B reflects the server window: with device B's clock
      manually set 5 minutes wrong, a fresh claim still shows ~60s remaining
      (server-time offset works).
- [ ] 1.6 Refreshing either device mid-game rebuilds identical state (claims, statuses,
      scores) from the database — statuses are derived, not remembered.

## Increment 2 — Offline queue + reconciliation

- [ ] 2.1 Device A in airplane mode: claiming an item updates its own UI instantly with
      a visible "pending sync" indicator. No error, no spinner blocking play.
- [ ] 2.2 Airplane mode off → the queued claim reaches device B within 5s of
      reconnection without any user action, and a fresh 60s window starts.
- [ ] 2.3 Kill the tab (or reboot the device) while claims are queued offline →
      reopen the app → queued claims survive and sync (localStorage queue).
- [ ] 2.4 Both devices offline: A claims, B cannot see it (expected). Both back online:
      B sees the claim, confirms within the window, claim scores. The all-offline
      round resolves with no special handling.
- [ ] 2.5 Flush interrupted mid-way (toggle airplane mode rapidly during sync) →
      no duplicate claims ever appear on any device (idempotent upsert by client UUID).
- [ ] 2.6 Device B backgrounded (screen locked) while A claims and a third session
      confirms → B foregrounded → B shows the confirmed claim and correct score
      within 3s without a manual refresh (visibilitychange reconcile).
- [ ] 2.7 Two devices claim the same `first_per_day` item while both offline; on
      reconnect exactly one enters pending (earlier `synced_at`), the other shows
      "beaten to it", and only one can ever score.

## Increment 3 — Real UI + scoreboard + shell cache (ship line)

- [ ] 3.1 On an iPad and an iPhone (or simulated viewports), every tappable game
      control is ≥ 44px in both dimensions; claim buttons ≥ 60px tall.
- [ ] 3.2 A first-time user can, with zero instructions: pick their player, find an
      item, claim it, and see their score — verified by handing the device to
      someone who hasn't seen the app.
- [ ] 3.3 Incoming claims appear as a banner with item, claimer, countdown, and a
      one-tap Confirm — reachable from any screen in the app.
- [ ] 3.4 Scoreboard shows today's totals and whole-trip totals per player; switching
      views takes one tap; totals match a hand computation of confirmed claims
      (points + adjustments).
- [ ] 3.5 An item already claimed by me today (`per_player_per_day`) or taken today
      (`first_per_day`) or taken this trip (`once_per_trip`) is visibly disabled with
      the reason.
- [ ] 3.6 With airplane mode on and the tab killed, reopening the home-screen app
      loads the board from the service worker cache (queued play per 2.x still works).
- [ ] 3.7 Add-to-homescreen on iOS yields a full-screen app (no Safari chrome) with a
      named icon.

## Increment 4 — Team days

- [ ] 4.1 A parent sets today's mode to teams; all devices switch to team scoreboard
      within 2s.
- [ ] 4.2 Team score = sum of both members' confirmed points today; verified by hand
      against the claims table.
- [ ] 4.3 Daily winner banner shows on the scoreboard after mode is teams and scores
      are nonzero; trip view shows team-day win count and still shows individual trip
      totals.
- [ ] 4.4 Mode persists: a device that reloads (or was offline during the switch)
      lands in the correct mode.

## Increment 5 — Parent admin panel

- [ ] 5.1 Admin panel is reachable only when the selected player has role 'parent';
      kid players never see the entry point.
- [ ] 5.2 Reviving an expired claim marks it confirmed on all devices and scores it.
- [ ] 5.3 Denying a claim removes its points on all devices and shows it as denied.
- [ ] 5.4 A point adjustment (+/-) with a note changes the claim's effective points
      everywhere; the note is visible on the claim.
- [ ] 5.5 All admin actions survive the offline queue (performed in airplane mode,
      correct everywhere after reconnect).

## Increment 6 — Kid-friendly item editor

- [ ] 6.1 A kid can add an item (name, emoji, points, rule) and it is claimable on all
      devices within 2s.
- [ ] 6.2 Retiring an item hides it from all boards without touching its historical
      claims or scores.
- [ ] 6.3 Editing an item's points changes future claims only; already-confirmed
      claims keep the points they scored with. (Implementation note: this requires
      snapshotting points onto the claim at claim time OR computing from item history —
      Sonnet must pick one and state it in the commit.)
- [ ] 6.4 Point values outside 1–100 are rejected client-side and by the DB CHECK.

## Definition of done (v1, from CLAUDE.md)

- [ ] All of increments 0–6 pass on the actual four devices.
- [ ] A claim made on one iPad appears on the other three devices within ~2s on good
      signal.
- [ ] Both girls each complete a full claim→confirm→score round without adult help.

## Review log

_(Fable appends review verdicts here: date, diff reviewed, pass/fail per criterion,
required fixes.)_
