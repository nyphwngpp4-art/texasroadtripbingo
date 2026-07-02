# texasroadtripbingo — Four-Player Road Trip Bingo

## What this is
A live, multi-device road-trip bingo/scavenger game for a family of four: two daughters on iPads, two parents on iPhones. Month-long Texas trip. All four are players; parents additionally get an admin view. Running scoreboard across the whole trip.

## Devices and sync (DECIDED)
- Four devices: 2 iPads (girls), 2 iPhones (parents). All hit the same Cloudflare Pages URL; add-to-homescreen for full-screen. No app install.
- Sync backend: Supabase realtime. One shared trip room.
- Schema: 3 tables max — players, items, claims (confirmations as columns on claims). Anon key only, RLS on, no PII beyond first names.
- OFFLINE REQUIREMENT: cell coverage on the AZ→TX route is spotty. Claims must queue locally when offline and sync when signal returns — never fail or block on connectivity. Design the claim/confirm flow to tolerate delayed sync gracefully.

## Core mechanic — claim + verify
1. A player spots an item and taps to claim it.
2. The claim pushes to the other three devices in real time.
3. Any other player must confirm within a time window (default 60s) or the claim expires. Self-confirmation not allowed.
4. Confirmed claims score; the scoreboard updates live on all devices.
This verification loop is the heart of the game — it settles disputes structurally and keeps everyone engaged. Get it right before anything else.

## Product intent (v1)
- ~30 starter items in /data/items.json (longhorn, water tower, out-of-state plate, Whataburger, wind turbines, Buc-ee's, etc.) with point values
- Live scoreboard: whole-trip total plus per-day view
- Game modes selectable per day: free-for-all or girls-vs-parents teams
- Item editor (kid-friendly): add/edit/retire items with point values
- Parent admin view on iPhones: adjust points, resolve contested claims, manage items
- v2 (do NOT build in v1): alternating-turn story builder with PDF keepsake export

## Stack and constraints
- Vanilla HTML/CSS/JS. Tailwind via CDN. No build step, no framework.
- Deploy target: Cloudflare Pages (static) + Supabase (data/realtime).
- Mobile-first, large touch targets, fast and fun over feature-rich. A 9-year-old needs zero instructions.

## Repo conventions
- index.html entry; JS modules under /js (suggest: supabase.js, state.js, claims.js, ui.js); starter items in /data/items.json.
- Heavy comments; document the schema and the offline queue design where they live.

## Workflow (multi-model)
- Claude Fable (Mythos-class model) writes PLAN.md and ACCEPTANCE.md first, interrogating the user on remaining requirements.
- Claude Sonnet implements against PLAN.md incrementally.
- Fable reviews diffs against ACCEPTANCE.md; verdicts in ## Review log at the bottom of ACCEPTANCE.md.
- No scope expansion beyond PLAN.md without asking the user.

## Definition of done (v1)
All ACCEPTANCE.md items pass on the actual four devices: a claim made on one iPad appears on the other three devices within ~2s on good signal, queues and syncs correctly when offline, and both girls can play a full round without adult help.
