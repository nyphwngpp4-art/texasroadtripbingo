-- ============================================================================
-- texasroadtripbingo — seed data
-- >>> EDIT THE FOUR PLAYER NAMES BELOW (first names only) before running. <<<
-- Run AFTER schema.sql, in the Supabase SQL editor.
-- Items mirror data/items.json — that file is the source of truth; if you
-- change one, change the other.
-- ============================================================================

insert into public.players (name, role, team) values
  ('Kid1',    'kid',    'girls'),    -- EDIT ME
  ('Kid2',    'kid',    'girls'),    -- EDIT ME
  ('Parent1', 'parent', 'parents'),  -- EDIT ME
  ('Parent2', 'parent', 'parents');  -- EDIT ME

insert into public.items (name, emoji, points, claim_rule) values
  -- commons: 5 pts, once per player per day
  ('Out-of-state license plate',            '🚗', 5,  'per_player_per_day'),
  ('Water tower with a town name',          '💧', 5,  'per_player_per_day'),
  ('Freight train',                         '🚂', 5,  'per_player_per_day'),
  ('Hawk on a pole or fence post',          '🦅', 5,  'per_player_per_day'),
  ('Horses in a field',                     '🐴', 5,  'per_player_per_day'),
  ('Herd of cows',                          '🐄', 5,  'per_player_per_day'),
  ('Truck hauling hay bales',               '🚛', 5,  'per_player_per_day'),
  ('RV or camper trailer',                  '🏕️', 5,  'per_player_per_day'),
  ('Group of 3 or more motorcycles',        '🏍️', 5,  'per_player_per_day'),
  -- uncommons: 10 pts, once per player per day
  ('Saguaro cactus (Arizona only!)',        '🌵', 10, 'per_player_per_day'),
  ('Real longhorn — horns required',        '🤘', 10, 'per_player_per_day'),
  ('Wind turbine farm',                     '🌬️', 10, 'per_player_per_day'),
  ('Oil pump jack actually pumping',        '🛢️', 10, 'per_player_per_day'),
  ('Cotton field',                          '☁️', 10, 'per_player_per_day'),
  ('Tumbleweed on the move',                '🧹', 10, 'per_player_per_day'),
  ('Dust devil',                            '🌪️', 10, 'per_player_per_day'),
  ('Grain elevator',                        '🌾', 10, 'per_player_per_day'),
  ('Dairy Queen sign',                      '🍦', 10, 'per_player_per_day'),
  ('Whataburger',                           '🍔', 10, 'per_player_per_day'),
  ('Pecan orchard in rows',                 '🌳', 10, 'per_player_per_day'),
  ('Adobe building',                        '🧱', 10, 'per_player_per_day'),
  ('Roadside historical marker',            '📜', 10, 'per_player_per_day'),
  -- rares: 25 pts, first confirmed claim of the day takes it
  ('Border Patrol checkpoint',              '🛂', 25, 'first_per_day'),
  ('Real roadrunner (the bird!)',           '🐦', 25, 'first_per_day'),
  ('Anything alien or UFO themed',          '👽', 25, 'first_per_day'),
  ('Chile ristra hanging up',               '🌶️', 25, 'first_per_day'),
  ('Train with 50+ cars — count them!',     '🔢', 25, 'first_per_day'),
  -- epics: 50 pts, once for the whole trip
  ('Welcome to New Mexico state line sign', '🎈', 50, 'once_per_trip'),
  ('Welcome to Texas state line sign',      '⭐', 50, 'once_per_trip'),
  ('Buc-ee''s — any sighting counts',       '🦫', 50, 'once_per_trip');
