# Tray and operation sound regression notes

## Root Cause Analysis

**Error:** Selected tray beads were clipped; repeated tray refreshes replayed their
entrance animation. Some visible-bead clicks missed, and synthesized sounds differed
from the supplied recording.

**Expected:** Beads lift fully above their slots, remain selected through refreshes,
respond to each click, and use the corresponding operation's reference sound.

**Cause:** The tray scroll viewport had no lift headroom. `renderTray` replaced every
button, including buttons held between pointerdown and pointerup. The board hit-tested
unraised cells even when beads were drawn above them. Tray beads with no matching
holes returned before selection. Audio resumed without awaiting the running clock,
and the old oscillator approximations omitted the recorded timbre/transients.

**Fix:** Preserve slot and bead DOM nodes, reserve scroll padding for lift/shadows,
hit-test lifted board geometry first, allow tray selection before holes are available,
and use cleaned reference samples with fresh playback nodes. Prime audio on user
gestures, await context recovery, cache buffers, and invalidate pending playback when
muting. Tray-to-board flights start at the selected bead's raised position.

**Prevention:** `tests/audio.test.ts` covers rapid playback, suspended-context startup,
mute cancellation, interrupted-context recovery, unsupported audio and asset failure.
Browser verification covers node identity through refresh, a refresh between down/up,
visible raised-board hit targets, tray selection without holes, mobile/desktop bounds,
and actual decoded playback of pick, slot, place, completion and victory sounds.

Implementation follows the existing TypeScript/Web Audio architecture with no new
runtime dependencies. API references: [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume),
[AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode),
and [MDN Web Audio examples](https://github.com/mdn/webaudio-examples).

## Follow-up: touch recovery and occupied-slot intention

The first audio fix could remain stuck behind an unresolved `resume()` promise from
touch pointerdown. Touch/pen user activation occurs on release. Recovery now runs on
pointerup/touchend/click as well, and a pending promise never prevents a new resume
attempt. A bounded queue flushes once the context actually becomes running, including
when that state change follows promise resolution. Muted and stale queued taps are
discarded. The regression tests first reproduced both failures against the old code.

Occupied-slot clicks now take priority over the board-to-tray action. They switch the
floating selection without moving board beads or opening an unlock dialog, whether
the tray is full or partly full. A switch from a board selection also stays a selection
when auto-fill is enabled. Explicit locked-slot clicks and deposit attempts on the
full tray background retain the unlock flow. `tests/traySelection.test.ts` covers these
paths using the real game engine and the screen's click handler.

Activation reference: [WebKit user activation](https://webkit.org/blog/13862/the-user-activation-api/).
