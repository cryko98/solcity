"""
The trailer's sounds (trailer/music, voice, sfx: MP3 from ElevenLabs) as 44.1 kHz stereo 16-bit WAV in
trailer/build/, for trailer/mix.mjs to read.

  blender -b --factory-startup -P trailer/towav.py -- <repo root>
"""
import aud, os, sys, wave
import numpy as np

ROOT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
OUT = os.path.join(ROOT, "trailer", "build")
os.makedirs(OUT, exist_ok=True)
for sub in ("music", "voice", "sfx"):
    d = os.path.join(ROOT, "trailer", sub)
    for f in sorted(os.listdir(d)):
        if not f.endswith(".mp3"):
            continue
        dst = os.path.join(OUT, f"{sub}_{f[:-4]}.wav")
        if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(os.path.join(d, f)):
            continue
        # (decoded to samples and written here: ffmpeg's WAV writer fails on some of these)
        x = aud.Sound(os.path.join(d, f)).resample(44100, True).rechannel(2).data()
        pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
        with wave.open(dst, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(44100)
            w.writeframes(pcm.tobytes())
        print("wav", sub, f)
