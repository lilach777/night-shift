// Sound id -> file(s). Multiple files = random variation.
// Ogg Vorbis: gapless loops and small files in Chrome, Edge and Firefox.
const A = 'assets/audio/';   // relative: works at the domain root or in a sub-folder
const EXT = '.ogg';
const v = (dir, base, n) => Array.from({ length: n }, (_, i) => `${A}${dir}/${base}_${i + 1}${EXT}`);
const one = (dir, base) => [`${A}${dir}/${base}${EXT}`];

export const MANIFEST = {
  // music
  piano: Array.from({ length: 12 }, (_, i) => `${A}music/piano_${String(i).padStart(2, '0')}${EXT}`),
  tension_loop: one('music', 'tension_loop'),
  chase_loop: one('music', 'chase_loop'),
  stinger_hit: one('music', 'stinger_hit'),
  stinger_reveal: one('music', 'stinger_reveal'),
  menu_drone: one('music', 'menu_drone'),
  ending_drone: one('music', 'ending_drone'),
  // ambience
  rain_outside: one('ambience', 'rain_outside'),
  rain_inside: one('ambience', 'rain_inside'),
  wind: one('ambience', 'wind'),
  hum_electric: one('ambience', 'hum_electric'),
  room_tone: one('ambience', 'room_tone'),
  basement_drips: one('ambience', 'basement_drips'),
  basement_air: one('ambience', 'basement_air'),       // CC0 Freesound 161221 (plant-room fans)
  key_pickup: one('player', 'key_pickup'),             // CC0 Freesound 267711
  morning_wind: one('ambience', 'morning_wind'),
  // environment
  thunder: v('environment', 'thunder', 4),
  thunder_near: one('environment', 'thunder_near'),
  // doors — real CC0 recordings (see public/assets/audio/CREDITS_EXTERNAL.json)
  door_wood_open: v('environment', 'door_wood_open', 3),
  door_wood_close: v('environment', 'door_wood_close', 4),
  door_latch: v('environment', 'door_latch', 6),
  door_heavy_open: one('environment', 'door_heavy_open'),
  door_heavy_close: one('environment', 'door_heavy_close'),
  door_basement_open: one('environment', 'door_basement_open'),
  door_basement_close: one('environment', 'door_basement_close'),
  door_morgue_open: one('environment', 'door_morgue_open'),
  door_morgue_close: one('environment', 'door_morgue_close'),
  door_slam: one('environment', 'door_slam'),
  door_creak: one('environment', 'door_creak'),
  door_bang: v('environment', 'door_bang', 3),
  door_locked: v('environment', 'door_latch', 3),
  // drawers / cabinets / closets
  drawer_wood_open: v('environment', 'drawer_wood_open', 2),
  drawer_wood_close: v('environment', 'drawer_wood_close', 2),
  drawer_metal_open: v('environment', 'drawer_metal_open', 2),
  drawer_metal_close: v('environment', 'drawer_metal_close', 2),
  cabinet_open: one('environment', 'cabinet_open'),
  cabinet_close: one('environment', 'cabinet_close'),
  phone_busy: one('environment', 'phone_busy'),
  metal_scrape: v('environment', 'metal_scrape', 2),
  object_fall: v('environment', 'object_fall', 2),
  elevator_ding: one('environment', 'elevator_ding'),
  elevator_motor: one('environment', 'elevator_motor'),
  monitor_beep: one('environment', 'monitor_beep'),
  pa_click: one('environment', 'pa_click'),
  pa_static: one('environment', 'pa_static'),
  power_down: one('environment', 'power_down'),
  power_up: one('environment', 'power_up'),
  light_buzz: one('environment', 'light_buzz'),
  light_flicker: one('environment', 'light_flicker'),
  phone_ring: one('environment', 'phone_ring'),
  phone_pickup: one('environment', 'phone_pickup'),
  phone_hangup: one('environment', 'phone_hangup'),
  phone_static: one('environment', 'phone_static'),
  drip: v('environment', 'drip', 3),
  distant_scream: one('environment', 'distant_scream'),
  fuse_insert: one('environment', 'fuse_insert'),
  lever: one('environment', 'lever'),
  car_engine: one('environment', 'car_engine'),
  car_door: one('environment', 'car_door'),
  entrance_unlock: [`${A}environment/door_latch_4${EXT}`],
  entrance_slam: one('environment', 'door_heavy_close'),
  entrance_open: one('environment', 'door_heavy_open'),
  impact_low: one('environment', 'impact_low'),
  // soundscape: the building settling around the listener (see soundscape.js)
  amb_creak: v('environment', 'amb_creak', 4),
  amb_pipe: v('environment', 'amb_pipe', 3),
  amb_metal: v('environment', 'amb_metal', 2),
  amb_relay: v('environment', 'amb_relay', 2),
  // fear emitter: proximity drones while the Koala is near but unseen
  fear_low: one('music', 'fear_low'),
  fear_high: one('music', 'fear_high'),
  wet_slap: one('environment', 'wet_slap'),
  // player
  // footsteps — walking + running: the concrete-footsteps recording supplied for the game
  // (freesound_community "concrete footsteps 1", 6265), sliced into single steps;
  // stairs: concrete stairwell recordings (see CREDITS_EXTERNAL.json)
  step_tile: v('player', 'step_tile', 10),
  run_tile: v('player', 'run_tile', 12),
  step_concrete: v('player', 'step_concrete', 10),
  run_concrete: v('player', 'run_concrete', 12),
  step_stairs: v('player', 'step_stairs', 10),
  step_outside: v('player', 'step_outside', 3),
  cloth: v('player', 'cloth', 2),
  flashlight_click: one('player', 'flashlight_click'),
  battery_swap: one('player', 'battery_swap'),
  pickup: one('player', 'pickup'),
  heartbeat: one('player', 'heartbeat'),
  // monster
  // recorded creature layers (CC0, Freesound 844096 / 734900 / 261464, pitched down)
  koala_breath: [...one('monster', 'koala_breath_rec_1'), ...one('monster', 'koala_breath_rec_2')],
  koala_growl: [...one('monster', 'koala_growl_rec_1'), ...one('monster', 'koala_growl_rec_2'), ...v('monster', 'koala_growl', 1)],
  koala_sniff: one('monster', 'koala_sniff'),
  emerge_roar: one('monster', 'emerge_roar'),
  // Koala emergence from the morgue floor (CC0, Freesound — see CREDITS_EXTERNAL.json)
  emerge_rumble: one('environment', 'emerge_rumble'),
  emerge_crack: one('environment', 'emerge_crack'),
  emerge_break: v('environment', 'emerge_break', 3),
  emerge_debris: v('environment', 'emerge_debris', 4),
  emerge_wet: one('environment', 'emerge_wet'),
  emerge_joints: one('environment', 'emerge_joints'),
  koala_scream: one('monster', 'koala_scream'),
  koala_screech: one('monster', 'koala_screech'),
  koala_scratch: one('monster', 'koala_scratch'),
  koala_step: v('monster', 'koala_step', 3),
  koala_attack: one('monster', 'koala_attack'),
  koala_distant: v('monster', 'koala_distant', 2),
  koala_chitter: one('monster', 'koala_chitter'),
  jumpscare_hit: one('monster', 'jumpscare_hit'),
  // voice
  vo_phone_threat: one('voice', 'phone_threat'),
  vo_phone_laugh: one('voice', 'phone_laugh'),
  // Chatterbox neural TTS (Resemble AI, MIT) conditioned on synthetic Kokoro (Apache-2.0)
  // reference voices — no real person's voice is cloned.
  vo_see_tonight: one('voice', 'see_tonight'),          // the reflection
  vo_intercom: one('voice', 'intercom'),                // "You shouldn't have turned it back on."
  vo_phone_trapped: one('voice', 'phone_trapped'),
  vo_phone_was_you: one('voice', 'phone_was_you'),
  vo_employee: one('voice', 'employee'),
  vo_go_back: one('voice', 'go_back'),                  // the one-time "GO BACK!" scream
  // protagonist (Arman): short, natural reactions only
  ...Object.fromEntries(['what_was_that', 'shit', 'wait_what', 'wtf', 'fuse_one', 'another_one', 'last_one', 'come_on', 'run', 'get_away', 'jesus', 'whos_there', 'night_guard']
    .map(k => ['vo_arman_' + k, one('voice', 'arman_' + k)])),
  // multiplayer-only lines (src/mp/lines.js) - never played in single-player
  ...Object.fromEntries(['mp_call_1', 'mp_call_2', 'mp_call_3', 'mp_call_4', 'mp_call_5', 'mp_call_6',
    'mp_pa_lockdown', 'mp_pa_power_a', 'mp_pa_power_b', 'mp_pa_breach', 'mp_pa_field', 'mp_pa_unstable', 'mp_pa_unlock', 'mp_pa_purge',
    'mp_end_1', 'mp_end_2']
    .map(k => [k, one('voice', k)])),
  // ui
  ui_hover: one('ui', 'ui_hover'),
  ui_click: one('ui', 'ui_click'),
  ui_confirm: one('ui', 'ui_confirm'),
  ui_fuse: one('ui', 'ui_fuse'),
};

// Loaded right after the user starts the game (small, needed immediately).
export const CRITICAL = ['rain_inside', 'rain_outside', 'thunder', 'piano', 'step_tile', 'run_tile', 'door_latch', 'door_wood_open', 'door_wood_close', 'ui_click', 'ui_hover', 'hum_electric', 'room_tone', 'car_engine', 'car_door', 'entrance_slam', 'wind'];
