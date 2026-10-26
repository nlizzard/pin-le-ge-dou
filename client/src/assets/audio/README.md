# Operation sounds

Source: user-supplied `Screenrecorder-2026-10-26-15-35-19-690.mp4` (2026-10-26).
These are extracted reference sounds, not oscillator approximations. No full recording
or background music track is bundled. Rebuild with:

```powershell
python tools/extract-reference-audio.py path/to/Screenrecorder-2026-10-26-15-35-19-690.mp4
```

The tool requires ffmpeg, numpy and scipy. Video timestamps account for the audio
stream's 2046/44100-second offset. Repeated sounds are aligned by waveform correlation
and median-combined to suppress music and unrelated overlapping sounds. Victory uses
spectral noise suppression because the recording contains only one victory.

| File | Reference time | Duration | Trigger |
| --- | --- | --- | --- |
| pick.wav | 2.164–2.258 s, 22 matches | 94 ms | Pick, cancel, wrong colour, ordinary click |
| slot.wav | 4.040–4.084 s, 31 matches | 44 ms | One bead lands in the tray |
| place.wav | 26.151–26.197 s, 104 matches | 46 ms | One bead lands in a board hole |
| complete.wav | 36.325–37.015 s, 4 matches | 690 ms | Region completion, after the final landing |
| win.wav | 65.360–68.350 s | 2990 ms | Victory |

Very short fades remove cut-edge clicks. Preserve the reference's fixed pitch during
combos. Each landing creates its own source; do not reuse a single playing source or
throttle rapid taps. Special actions absent from this recording retain synthesized cues.
