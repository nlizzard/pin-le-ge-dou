"""Extract operation sounds from the supplied 2026-10-26 reference recording.

Requires ffmpeg, numpy and scipy. Usage: python tools/extract-reference-audio.py video.mp4
Repeated, phase-aligned occurrences are median-combined to remove background music.
Times below are video times; the audio stream starts 2046 / 44100 seconds later.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate, find_peaks, stft, istft

raw = subprocess.check_output([
    'ffmpeg', '-v', 'error', '-i', sys.argv[1], '-vn', '-ac', '1',
    '-ar', '44100', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
])
rate, pcm = 44100, np.frombuffer(raw, dtype='<i2')
x = pcm.astype(np.float64) / 32768
offset = 2046 / 44100
out = Path(__file__).resolve().parents[1] / 'client/src/assets/audio'
out.mkdir(parents=True, exist_ok=True)

def clip(a, b):
    return x[round((a - offset) * rate):round((b - offset) * rate)]

def repeated(a, b, threshold):
    template = clip(a, b)
    c = correlate(x, template, mode='valid', method='fft')
    energy = np.r_[0, np.cumsum(x * x)]
    energy = energy[len(template):] - energy[:-len(template)]
    score = c / np.sqrt(np.maximum(energy, 1e-12) * np.sum(template * template))
    peaks, _ = find_peaks(score, height=threshold, distance=round((b-a) * rate))
    print(f'{a:.3f}s: combining {len(peaks)} matching occurrences')
    return np.median([x[i:i + len(template)] for i in peaks], axis=0)

def save(name, samples, fade=0.003):
    samples = samples - samples.mean()
    n = min(round(fade * rate), len(samples) // 4)
    samples[:min(44, n)] *= np.linspace(0, 1, min(44, n))
    samples[-n:] *= np.linspace(1, 0, n)
    wavfile.write(out / f'{name}.wav', rate, (np.clip(samples, -1, 1) * 32767).astype(np.int16))
    print(name, f'{len(samples)/rate:.3f}s', f'peak={np.max(np.abs(samples)):.3f}')

save('pick', repeated(2.164, 2.258, .94))
# Isolate ONE landing (the recording often plays two 46 ms apart).
save('place', repeated(26.151, 26.197, .93))
save('slot', repeated(4.040, 4.084, .88))
save('complete', repeated(36.325, 37.015, .83), .035)

# Only one victory in the clip: estimate the music floor from the idle opening.
win = clip(65.36, 68.35)
_, _, background = stft(clip(.15, 1.85), rate, nperseg=1024, noverlap=768)
_, _, spectrum = stft(win, rate, nperseg=1024, noverlap=768)
floor = np.mean(np.abs(background) ** 2, axis=1, keepdims=True)
gain = np.maximum(.03, 1 - 2 * floor / np.maximum(np.abs(spectrum) ** 2, 1e-12))
_, cleaned = istft(spectrum * gain, rate, nperseg=1024, noverlap=768)
save('win', cleaned[:len(win)], .12)
