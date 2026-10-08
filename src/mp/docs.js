// NIGHT SHIFT multiplayer - the documents the crew finds (MULTIPLAYER ONLY).
// The story is told in the order these are found; each one answers a little and asks more:
//   work order (van)      why they are here: restore the power before the 6:00 AM demolition
//   maintenance log (103) the evacuation, the fuses, the scratching, the corridor locked from inside
//   generator log (B10)   the power was cut ON PURPOSE, at the panel, the night of the evacuation
//   fuse tags (x4)        normal -> evacuation -> restricted -> "destroy, do not reinstall"
//   K-7 file (408)        what is in B11, that main power releases it, the night crews... "they knew."
//   procedure placards    the original containment infrastructure at 403 / 309 / B11
// Pages are arrays of HTML strings; the reader pages through them with [E].

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function workOrder(names) {
  const crew = names.length ? names.map(esc).join(', ') : 'NIGHT CREW';
  return {
    title: 'WORK ORDER 4471 - DECOMMISSIONING',
    pages: [`
      <p class="doc-stamp">ST. MERCY HOSPITAL &middot; SITE CLOSED</p>
      <p><b>CREW:</b> ${crew} &nbsp;(night rate)</p>
      <p><b>TASK:</b> Restore main power from the basement panel so the records system can be wiped before
      the building comes down. Demolition is scheduled for <b>6:00 AM</b>. Be out by then.</p>
      <p><b>ACCESS:</b> Front entrance is open for you. The caretaker will call the reception desk with
      instructions.</p>
      <p><b>NOTE:</b> Sub-Level B past the power room is not part of this job.</p>
      <p class="doc-hand">Don't ask about the overtime. Just get the lights on. &mdash; H.</p>`],
  };
}

export const MAINT_LOG = {
  title: 'MAINTENANCE LOG - NIGHT CREW',
  pages: [`
    <p><b>Oct 2.</b> Generator in B10 only runs on the fuel primer. Hold the primer, pull the cord. Takes two.</p>
    <p><b>Oct 4.</b> Spare keys for the stairwell gate and the power room are in the storage room (104).</p>
    <p><b>Oct 6.</b> Main panel trips every night around 2. Always the B-wing circuit.</p>
    <p><b>Oct 9.</b> Night staff hear scratching inside the walls on Sub-Level B. Pest control found nothing.
    They say it follows them along the corridor.</p>`, `
    <p><b>Oct 11.</b> Administration: nobody goes past B10 without Dr. Halloway. B11 is locked from the inside.
    Who locks a corridor from the inside?</p>
    <p><b>Oct 12.</b> Vance (orderly) found sitting in B10 with every light off. Said he was "keeping it quiet."
    Sent home.</p>
    <p><b>Oct 13.</b> Evacuation. Patients first, then staff. Halloway had the main power cut at the panel and
    all four fuses pulled and carried out of the basement. Why take the fuses?</p>
    <p class="doc-torn">[ the rest of the page is torn out ]</p>`],
};

export const GEN_LOG = {
  title: 'GENERATOR LOG - B10',
  pages: [`
    <p><b>13 OCT 01:58</b> &nbsp;Main power OFF at the panel. By order of Dr. M. Halloway.</p>
    <p><b>13 OCT 02:04</b> &nbsp;Fuses 1-4 removed. Taken off the sub-level. Panel tagged.</p>
    <p><b>13 OCT 02:10</b> &nbsp;Generator isolated from the B-wing. Emergency lighting only.</p>
    <p><b>13 OCT 02:13</b> &nbsp;The scratching stopped.</p>
    <p class="doc-stamp red">DO NOT RE-ENERGISE MAIN POWER</p>`],
};

// tag text by the order the fuses are found (not by room): the story escalates whoever finds them
export const FUSE_TAGS = [
  { title: 'FUSE TAG', html: '<p><b>FUSE 1 &mdash; MAIN FEED A</b></p><p>Removed 13 OCT for transport. Panel B10.</p><p class="doc-hand">&mdash; maint.</p>', thought: '(Just a fuse. Somebody tagged it.)' },
  { title: 'FUSE TAG', html: '<p><b>FUSE 2 &mdash; MAIN FEED B</b></p><p>Pulled during the evacuation. Keep OFF SITE until demolition.</p>', thought: '(Off site... so why was it hidden up here?)' },
  { title: 'FUSE TAG', html: '<p><b>FUSE 3 &mdash; B-WING</b></p><p class="doc-stamp red">DO NOT REINSTALL</p><p>Authorised: M. Halloway</p>', thought: '(Do not reinstall. And the job is to put it back.)' },
  { title: 'FUSE TAG', html: '<p><b>FUSE 4 &mdash; CHAMBER LOCKS / B11</b></p><p class="doc-stamp red">IF FOUND: DESTROY.<br>DO NOT RETURN TO THE PANEL.</p><p class="doc-hand">the tag is scratched, deep, like something tried to get it off</p>', thought: '(Chamber locks... What is in B11?)' },
];

export function k7File(n) {
  const rows = [['1987', 4, 3], ['1994', 4, 3], ['2003', 4, 3], ['2011', 4, 3], ['2019', 4, 3]];
  const table = rows.map(([y, a, r]) => `<tr><td>${y}</td><td>${a}</td><td>${r}</td></tr>`).join('');
  return {
    title: 'CONTAINMENT FILE - SPECIMEN K-7',
    pages: [`
      <p class="doc-stamp red">RESTRICTED &middot; SUB-LEVEL B, ROOM 11</p>
      <p><b>RECOVERED:</b> March 1987.</p>
      <p><b>DESCRIPTION:</b> Mammal-like organism. Continues to grow. Shows no sign of ageing.
      Responds to light and noise. <b>Hunts by sound.</b></p>
      <p><b>CONTAINMENT:</b> The chamber locks hold only while the main power is OFF and the seal is engaged.
      <b>Restoring main power releases the chamber locks.</b></p>
      <p><b>EMERGENCY:</b> Engage all three containment switches &mdash; Control 403, Electrical 309,
      Containment B11 &mdash; then purge from B11.</p>`, `
      <p><b>NIGHT CREW RECORD</b> &nbsp;(power restoration, Sub-Level B)</p>
      <table class="doc-table"><tr><th>YEAR</th><th>SENT</th><th>RETURNED</th></tr>${table}
      <tr class="now"><td>TONIGHT</td><td>${n}</td><td>&nbsp;</td></tr></table>
      <p class="doc-hand red">they sent a night crew to turn the power back on. they knew.</p>`],
  };
}

export const PLACARDS = [
  { title: 'EMERGENCY CONTAINMENT - STAGE 1', html: '<p><b>CONTROL ROOM 403 &middot; FIELD SWITCH</b></p><p>Hold the field switch until the lamp turns green. The field will not hold on its own.</p><p class="doc-stamp red">THE SWITCH IS LOUD. IT WILL HEAR YOU.</p>' },
  { title: 'EMERGENCY CONTAINMENT - STAGE 2', html: '<p><b>ELECTRICAL 309 &middot; B-WING ISOLATION</b></p><p>Two keys, turned together. The keys are four metres apart by design.</p><p class="doc-stamp red">NOBODY DOES THIS ALONE.</p>' },
  { title: 'EMERGENCY CONTAINMENT - STAGE 3', html: '<p><b>CONTAINMENT B11 &middot; CHAMBER SEAL</b></p><p>Hold until the seal releases the purge controls. Then purge. Then leave.</p><p class="doc-stamp red">DO NOT LOOK INTO THE CHAMBER.</p>' },
];
