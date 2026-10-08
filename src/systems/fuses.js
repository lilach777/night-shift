// Four-fuse objective: seeded random selection from the layout's pool of valid
// locations (one per room, never duplicated, spread across floors, all reachable —
// no fuse is ever behind a locked door) + the basement power panel.
// A fuse only ever lies ON a table top or INSIDE a drawer that opens (never on floors,
// shelves, cabinets or closets): each room offers its valid surface/drawer spots.
import * as THREE from 'three';
import { seededRandom, shuffle } from '../core/util.js';
import { audio } from '../audio/audio.js';

export function chooseFuses(layout, seed) {
  const rnd = seededRandom(seed);
  const lockedRooms = new Set(layout.doors.filter(d => d.locked).map(d => d.room));
  const pool = layout.fuseLocations.filter(f => !lockedRooms.has(f.room));
  const floors = shuffle([...new Set(pool.map(f => f.level))], rnd);
  // exactly four, unique rooms, at most one per floor while possible, at least 3 floors
  const chosen = [];
  for (const fl of floors) {
    if (chosen.length >= 4) break;
    const opts = pool.filter(f => f.level === fl);
    chosen.push(opts[Math.floor(rnd() * opts.length)]);
  }
  while (chosen.length < 4) {
    const rest = pool.filter(f => !chosen.includes(f));
    chosen.push(rest[Math.floor(rnd() * rest.length)]);
  }
  return chosen.map(f => f.room);
}

// the concrete spot inside a chosen room (table top or drawer), seeded
export function chooseSpot(layout, seed, room) {
  const loc = layout.fuseLocations.find(f => f.room === room);
  const rnd = seededRandom(seed * 31 + [...room].reduce((s, c) => s + c.charCodeAt(0), 0));
  return { loc, spot: loc.spots[Math.floor(rnd() * loc.spots.length)], yaw: (rnd() - 0.5) * 1.2 };
}

export function validateFuses(layout, rooms) {
  const errs = [];
  if (rooms.length !== 4) errs.push('not exactly four');
  if (new Set(rooms).size !== 4) errs.push('duplicate location');
  const levels = rooms.map(r => layout.fuseLocations.find(f => f.room === r)?.level);
  if (levels.some(l => !l)) errs.push('unknown location');
  const kinds = rooms.flatMap(r => layout.fuseLocations.find(f => f.room === r)?.spots.map(s => s.kind) || []);
  if (kinds.some(k => k !== 'top' && k !== 'drawer')) errs.push('fuse not on a table or in a drawer');
  if (new Set(levels).size < 2) errs.push('all on one floor');
  const locked = new Set(layout.doors.filter(d => d.locked).map(d => d.room));
  if (rooms.some(r => locked.has(r))) errs.push('behind locked door');
  return errs;
}

export class Fuses {
  constructor(g) {
    this.g = g;
    this.rooms = [];
    this.collectedRooms = new Set();
    this.inserted = 0;
    this.objects = new Map();
    this.panelSlots = [];
    this.active = false;
  }
  get collected() { return this.collectedRooms.size; }
  get carrying() { return this.collected - this.inserted; }

  setup(seed, collectedRooms = [], inserted = 0) {
    const g = this.g;
    this.seed = seed;
    this.rooms = chooseFuses(g.layout, seed);
    const errs = validateFuses(g.layout, this.rooms);
    if (errs.length) console.error('[fuses] invalid selection', errs, this.rooms);
    this.collectedRooms = new Set(collectedRooms);
    this.inserted = inserted;
    for (const room of this.rooms) {
      if (this.collectedRooms.has(room)) continue;
      this.spawn(room);
    }
    this.setupPanel();
  }

  spawn(room) {
    const g = this.g;
    const { spot, yaw } = chooseSpot(g.layout, this.seed, room);
    const m = g.world.item('fuse');
    let enabled = () => this.active;
    if (spot.kind === 'drawer') {
      // lying in the drawer tray: moves with the drawer, only reachable once it's pulled out
      const part = g.containers.byProp.get(spot.prop)?.[spot.drawer];
      if (part) {
        const d = part.def;
        m.position.set(0, 0.022, -Math.min(0.26, d.slide * 0.55));
        m.rotation.y = yaw * 0.25;
        part.pivot.add(m);
        enabled = () => this.active && part.amount > 0.65;
      } else { const p = g.layout.props.find(q => q.id === spot.prop); m.position.set(p.x, p.y + 0.8, p.z); g.scene.add(m); }
    } else {
      m.position.set(spot.x, spot.y, spot.z);
      m.rotation.y = spot.rot + yaw;
      (g.world.levels[g.layout.fuseLocations.find(f => f.room === room).level] || g.scene).add(m);
    }
    this.objects.set(room, m);
    this.spots = this.spots || {};
    this.spots[room] = spot;
    g.interact.add({
      id: 'fuse_' + room, pos: () => m.getWorldPosition(new THREE.Vector3()).setY(m.getWorldPosition(new THREE.Vector3()).y + 0.04), radius: 2.0, cone: 0.35,
      enabled,
      prompt: () => '[E] Pick Up Fuse',
      action: () => this.collect(room),
    });
  }

  collect(room) {
    const g = this.g;
    const m = this.objects.get(room);
    if (m) { m.removeFromParent(); this.objects.delete(room); }
    g.interact.remove('fuse_' + room);
    this.collectedRooms.add(room);
    audio.play('pickup', { bus: 'player', volume: 0.8 });
    audio.play('ui_fuse', { bus: 'ui', volume: 0.6 });
    g.ui.toast(`FUSE  ${this.collected}/4`);
    g.onFuseCollected(room);
  }

  setupPanel() {
    const g = this.g, P = g.layout.powerRoom.panel;
    // panel front faces +z at rot 0 (into the power room)
    const facing = Math.round(Math.cos(P.rot)) || 1;
    this.panelPos = new THREE.Vector3(P.x, P.y, P.z);
    for (let i = 0; i < 4; i++) {
      const pos = new THREE.Vector3(P.x + (-0.75 + i * 0.5) * facing, P.y + 1.32, P.z + facing * 0.3);
      const m = g.world.item('fuse');
      m.rotation.z = Math.PI / 2;
      m.position.copy(pos).add(new THREE.Vector3(0.07, -0.0, 0));   // fuse body sits r+4mm above its origin
      m.visible = i < this.inserted;
      g.scene.add(m);
      this.panelSlots.push(m);
    }
    this.lever = g.world.item('power_lever');
    this.lever.position.set(P.x + 1.0 * facing, P.y + 1.5, P.z + facing * 0.25);
    this.lever.rotation.y = facing > 0 ? 0 : Math.PI;
    this.lever.rotation.x = 0.0;
    g.scene.add(this.lever);
    g.interact.add({
      id: 'power_panel', pos: new THREE.Vector3(P.x, P.y + 1.3, P.z + facing * 0.3), radius: 2.3, cone: 0.6,
      enabled: () => g.story.canUsePanel() && this.inserted < 4 && g.story.stage !== 'powerroom',
      prompt: () => {
        if (this.carrying > 0) return '[E] Insert Fuse';
        if (this.inserted < 4) return `Power panel — ${this.inserted}/4 fuses`;
        return null;
      },
      action: () => { if (this.carrying > 0) this.insert(); },
    });
  }

  insert() {
    const g = this.g;
    const slot = this.panelSlots[this.inserted];
    if (slot) slot.visible = true;
    this.inserted++;
    audio.playAt('fuse_insert', this.panelPos.clone().setY(this.panelPos.y + 1.3), { bus: 'environment', volume: 0.9, reverb: 0.3 });
    g.ui.toast(`FUSE ${this.inserted} INSERTED`);
    g.onFuseInserted(this.inserted);
  }
}
