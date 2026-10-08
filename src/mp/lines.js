// Multiplayer-only voice lines (never used by the single-player story). Subtitled.
// The caretaker's call is split into breaths so the pauses are real silence, not TTS pacing;
// the last line is cut off mid-word by the line dropping.
export const LINES = {
  mp_call_1: { text: '"Hello? ...You made it. Good."', who: 'CARETAKER (PHONE)', dur: 2.8 },
  mp_call_2: { text: '"The power\'s been out since the evacuation."', who: 'CARETAKER (PHONE)', dur: 3 },
  mp_call_3: { text: '"There are flashlights on the desk. The staff keycard is in the top drawer."', who: 'CARETAKER (PHONE)', dur: 5 },
  mp_call_4: { text: '"Get the generator running in the basement."', who: 'CARETAKER (PHONE)', dur: 2.8 },
  mp_call_5: { text: '"Whatever you hear down there... stay together."', who: 'CARETAKER (PHONE)', dur: 3.2 },
  mp_call_6: { text: '"And whatever happens, don\'t open the—"', who: 'CARETAKER (PHONE)', dur: 3.2 },
  mp_pa_lockdown: { text: '"Emergency lockdown. Stairwell sealed."', who: 'PUBLIC ADDRESS', dur: 3.6 },
  mp_pa_power_a: { text: '"Main power restored."', who: 'PUBLIC ADDRESS', dur: 2.4 },
  mp_pa_power_b: { text: '"Containment systems... offline."', who: 'PUBLIC ADDRESS', dur: 3.2 },
  mp_pa_breach: { text: '"Warning. Containment breach. Sub-level B, room eleven."', who: 'PUBLIC ADDRESS', dur: 5.2 },
  mp_pa_field: { text: '"Containment field... partial."', who: 'PUBLIC ADDRESS', dur: 3 },
  mp_pa_unstable: { text: '"Warning. Power instability. Sub-level B."', who: 'PUBLIC ADDRESS', dur: 4.8 },
  mp_pa_unlock: { text: '"Purge controls unlocked. Sub-level B, room eleven."', who: 'PUBLIC ADDRESS', dur: 4.6 },
  mp_pa_purge: { text: '"Purge sequence armed. All personnel, evacuate."', who: 'PUBLIC ADDRESS', dur: 4.4 },
  mp_end_1: { text: '"Thank you for the power."', who: 'PHONE', dur: 2.6 },
  mp_end_2: { text: '"One of you stays for the next shift."', who: 'PHONE', dur: 3.4 },
};
