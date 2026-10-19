"""Original 45-second music bed for the FixList launch ad (numpy only, no samples).

120 BPM. Hook 0-4 s (sparse thumps), logo 4-8 s (impact + pad + arp), main
groove 8-40 s (C-G-Am-F with kick/clap/hats/bass/arp), outro 40-45 s.
Usage: scan/venv-python scripts/promo/ad/music.py recordings/ad/music.wav
"""
import sys
import wave

import numpy as np

SR = 44100
DUR = 45.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)


def hz(note):
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave + 1) - 69) / 12)


def fft_filter(x, lo=None, hi=None):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    mask = np.ones_like(f)
    if lo:
        mask *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        mask *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(spec * mask, len(x))


def place(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def saw_voice(freq, dur, harmonics=9, detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for d in (-detune, 0.0, detune):
        f = freq * (1 + d)
        for k in range(1, harmonics + 1):
            if f * k > 9000:
                break
            out += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28)) / k
    return out / 3


def env_adsr(n, a, r, sustain=1.0):
    e = np.full(n, sustain)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, sustain, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def kick():
    t = np.arange(int(0.42 * SR)) / SR
    f = 46 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 8.5)
    click = rng.standard_normal(len(t)) * np.exp(-t * 420) * 0.25
    return np.tanh((body + click) * 1.6)


def clap():
    t = np.arange(int(0.3 * SR)) / SR
    n = fft_filter(rng.standard_normal(len(t)), lo=900, hi=5200)
    e = np.zeros_like(t)
    for off in (0.0, 0.011, 0.022):
        e += np.where(t >= off, np.exp(-(t - off) * (55 if off < 0.02 else 14)), 0)
    return n * e * 0.6


def hat(open_=False):
    t = np.arange(int((0.18 if open_ else 0.06) * SR)) / SR
    n = fft_filter(rng.standard_normal(len(t)), lo=7000)
    return n * np.exp(-t * (18 if open_ else 70))


def pluck(freq, dur=0.32):
    t = np.arange(int(dur * SR)) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.12 * np.sin(6 * np.pi * freq * t)
    return s * np.exp(-t * 9) * np.minimum(1, t * 400)


def thump(freq=70):
    t = np.arange(int(0.6 * SR)) / SR
    f = freq * (1 + 0.6 * np.exp(-t * 25))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)


def impact(length=1.6):
    t = np.arange(int(length * SR)) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 6)) / SR) * np.exp(-t * 2.4)
    noise = fft_filter(rng.standard_normal(len(t)), hi=3500) * np.exp(-t * 3.2) * 0.35
    return boom + noise


def riser(dur):
    t = np.arange(int(dur * SR)) / SR
    p = t / dur
    noise = rng.standard_normal(len(t))
    chunks = 24
    out = np.zeros_like(t)
    for c in range(chunks):
        a, b = c * len(t) // chunks, (c + 1) * len(t) // chunks
        out[a:b] = fft_filter(noise[a:b], lo=300 + 5000 * (c / chunks) ** 2, hi=1200 + 9000 * (c / chunks))
    tone = np.sin(2 * np.pi * np.cumsum(220 + 900 * p ** 2) / SR) * 0.15
    return (out * 0.5 + tone) * p ** 2.2


def reverb(x, seconds=1.8, wet=0.28):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 3.2)
    ir = fft_filter(ir, hi=6000)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return x + wet * y


# ---------------------------------------------------------------- arrangement
L = np.zeros(N)
R = np.zeros(N)
drums = np.zeros(N)
pad = np.zeros(N)
lead = np.zeros(N)
bass = np.zeros(N)

chords = {'C': ['C3', 'E3', 'G3', 'C4'], 'G': ['B2', 'D3', 'G3', 'D4'], 'Am': ['A2', 'C3', 'E3', 'A3'], 'F': ['A2', 'C3', 'F3', 'C4']}
roots = {'C': 'C2', 'G': 'G1', 'Am': 'A1', 'F': 'F1'}
prog = ['C', 'G', 'Am', 'F']

# Hook 0-4 s: thump + pluck on each phrase, low drone.
for i, note in enumerate(['A3', 'C4', 'E4', 'G4']):
    place(drums, i * 1.0, thump(62), 0.9)
    place(lead, i * 1.0, pluck(hz(note), 0.6), 0.35)
drone = saw_voice(hz('A1'), 4.0, harmonics=5, detune=0.004) * env_adsr(int(4.0 * SR), 1.5, 0.6, 0.5)
place(pad, 0.0, drone, 0.22)
place(drums, 2.6, riser(1.4), 0.5)

# Logo 4-8 s: impact, pad swell, arp.
place(drums, 4.0, impact(), 0.95)
for bar in range(2):
    ch = prog[bar]
    start = 4.0 + bar * 2
    for note in chords[ch]:
        v = saw_voice(hz(note), 2.3, harmonics=7, detune=0.006) * env_adsr(int(2.3 * SR), 0.35, 0.5)
        place(pad, start, v, 0.11)
for k in range(16):
    t0 = 4.0 + k * 0.25
    ch = prog[int((t0 - 4.0) // 2)]
    notes = chords[ch][1:] + [chords[ch][1][:-1] + str(int(chords[ch][1][-1]) + 1)]
    place(lead, t0, pluck(hz(notes[k % 4]) * 2, 0.3), 0.16 + 0.1 * (k / 16))
place(drums, 6.4, riser(1.6), 0.75)

# Main groove 8-40 s.
kick_env = np.zeros(N)
for bar in range(16):
    start = 8.0 + bar * 2
    ch = prog[bar % 4]
    for note in chords[ch]:
        v = saw_voice(hz(note), 2.25, harmonics=8, detune=0.007) * env_adsr(int(2.25 * SR), 0.12, 0.35)
        place(pad, start, v, 0.1 if 24.0 <= start < 26.0 else 0.09)
    breakdown = 24.0 <= start < 26.0
    for b in range(4):
        tb = start + b * BEAT
        if breakdown:
            continue
        place(drums, tb, kick(), 0.85)
        e = np.exp(-np.arange(int(0.4 * SR)) / SR * 7)
        place(kick_env, tb, e)
        if b in (1, 3):
            place(drums, tb, clap(), 0.55)
        place(drums, tb + 0.25, hat(open_=(b == 3 and bar % 2 == 1)), 0.22)
        if bar >= 4:
            place(drums, tb + 0.125, hat(), 0.09)
            place(drums, tb + 0.375, hat(), 0.09)
        # offbeat bass
        bt = np.arange(int(0.22 * SR)) / SR
        f = hz(roots[ch])
        bs = (np.sin(2 * np.pi * f * bt) + 0.3 * np.sin(2 * np.pi * 2 * f * bt) + 0.12 * np.sin(2 * np.pi * 3 * f * bt)) * np.exp(-bt * 7) * np.minimum(1, bt * 200)
        place(bass, tb + 0.25, bs, 0.55)
        place(bass, tb, bs * 0.5, 0.35)
    # arpeggio 16ths, pattern up/down
    tones = chords[ch][1:] + [chords[ch][1][:-1] + str(int(chords[ch][1][-1]) + 1)]
    pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    for k in range(16):
        n = tones[pattern[k % 8]]
        place(lead, start + k * 0.125, pluck(hz(n) * 2, 0.22), 0.11 if bar < 4 else 0.13)
# transition swooshes before scene changes and the outro
for t0 in (15.5, 21.5, 27.5, 33.5):
    place(drums, t0, riser(0.5), 0.35)
place(drums, 24.0, impact(1.2), 0.45)
place(drums, 25.0, riser(1.0), 0.6)
place(drums, 38.4, riser(1.6), 0.7)

# Outro 40-45 s: impact, final chord, bell.
place(drums, 40.0, impact(2.4), 0.9)
for note in ['C3', 'E3', 'G3', 'C4', 'E4']:
    v = saw_voice(hz(note), 5.0, harmonics=7, detune=0.006) * env_adsr(int(5.0 * SR), 0.05, 3.5)
    place(pad, 40.0, v, 0.1)
for i, note in enumerate(['G4', 'C5', 'E5']):
    place(lead, 40.6 + i * 0.25, pluck(hz(note), 1.6), 0.22)

# ---------------------------------------------------------------- mix
duck = 1 - 0.55 * np.clip(kick_env, 0, 1)
pad_wet = reverb(fft_filter(pad, hi=5200) * duck, 2.2, 0.35)
lead_wet = reverb(lead, 1.6, 0.3)
bass_f = fft_filter(bass * duck, hi=900)
mix_mono = drums * 0.9 + bass_f * 0.9
# gentle stereo: pad and lead slightly offset between channels
delay = int(0.012 * SR)
L = mix_mono + pad_wet + lead_wet * 0.9
R = mix_mono + np.concatenate([np.zeros(delay), pad_wet[:-delay]]) + np.concatenate([np.zeros(delay // 2), lead_wet[:-(delay // 2)]]) * 0.9
master = np.stack([L, R], axis=1)
# fades and soft clip
fade_in = np.minimum(1, np.arange(N) / (0.02 * SR))
fade_out = np.clip((DUR - np.arange(N) / SR) / 1.2, 0, 1)
master *= (fade_in * fade_out)[:, None]
master = np.tanh(master * 1.1) / np.tanh(1.1)
master /= np.max(np.abs(master)) / 0.89

out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((master * 32767).astype('<i2').tobytes())
print(f'Wrote {out}: {DUR:.1f} s, {SR} Hz stereo')
