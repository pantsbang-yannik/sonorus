#!/bin/bash
# One-shot real-machine verifier for sonorus-tap.
# Generates a 440Hz test tone, plays it while capturing system audio,
# then computes RMS + 440Hz spectral power over the captured PCM.
#
# PREREQUISITE (one-time): grant the host app (the terminal that runs this,
# e.g. iTerm/Terminal, or Electron in production) the macOS
# "系统音频录制 / System Audio Recording" permission:
#   System Settings > Privacy & Security > System Audio Recording > enable your terminal.
# If never prompted, run once, click "Allow" on the dialog, then run again.

set -e
cd "$(dirname "$0")"
BIN="./sonorus-tap"
[ -x "$BIN" ] && [ -f "$BIN" ] || { echo "build first: ./build.sh"; exit 1; }

TMP="$(mktemp -d)"
TONE="$TMP/tone.wav"; PCM="$TMP/pcm.raw"; HDR="$TMP/header.json"
trap 'rm -rf "$TMP"' EXIT

python3 - "$TONE" <<'PY'
import wave, math, struct, sys
w = wave.open(sys.argv[1], 'w')
w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
w.writeframes(b''.join(struct.pack('<h', int(12000*math.sin(2*math.pi*440*i/48000))) for i in range(480000)))
w.close()
PY

( for i in 1 2; do afplay "$TONE"; done ) & APLAY=$!
"$BIN" 2>"$HDR" 1>"$PCM" & TAP=$!
sleep 7
kill "$TAP" 2>/dev/null || true
kill "$APLAY" 2>/dev/null || true
pkill afplay 2>/dev/null || true

echo "header: $(cat "$HDR")"
python3 - "$PCM" <<'PY'
import struct, math, sys
data = open(sys.argv[1], 'rb').read()
n = len(data)//4
if n == 0:
    print("FAIL: no PCM captured"); raise SystemExit(1)
vals = struct.unpack(f'<{n}f', data)
rms = (sum(v*v for v in vals)/n)**0.5
print("samples =", n, " duration ≈ %.2fs" % (n/2/48000))
print("rms =", rms)
left = vals[0::2]
N = min(len(left), 48000)
def goertzel(sig, freq, sr=48000):
    k = int(0.5 + N*freq/sr); w = 2*math.pi*k/N; c = 2*math.cos(w); s1=s2=0.0
    for x in sig[:N]:
        s0 = x + c*s1 - s2; s2, s1 = s1, s0
    return math.sqrt(max(s1*s1 + s2*s2 - c*s1*s2, 0))/N
p440, p1k = goertzel(left, 440), goertzel(left, 1000)
print("440Hz power = %.6f  1000Hz power = %.6f  ratio = %.1f" % (p440, p1k, p440/max(p1k,1e-12)))
if rms > 0.001:
    print("PASS: captured real audio (440Hz tone present)" if p440 > 5*max(p1k,1e-12) else "PASS: captured non-silent audio")
else:
    print("FAIL: silence (rms=0). Grant '系统音频录制' permission to this terminal and retry.")
    raise SystemExit(1)
PY
