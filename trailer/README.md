# The Sol City trailer (`SolCity_Trailer.mp4`)

88 seconds, 1080p, recorded from the game itself and cut to its own score, with a narrator. The picture
is `src/hype3.js`; the sound is made here.

| File | What it is |
|---|---|
| `script.json` | the narrator's lines (with the delivery in `[tags]`) and the score's sections, as they were generated |
| `voice/n01.mp3` … `n15.mp3` | the narrator: ElevenLabs v3, voice "Brian", through fal.ai |
| `music/score.mp3` | the score: ElevenLabs Music (instrumental west coast G-funk, 90 BPM), through fal.ai |
| `sfx/*.mp3` | the effects (`sfx.json` says what each one was asked to be): ElevenLabs Sound Effects |
| `gen.mjs` | makes all of the above again (`FAL_KEY` in the environment) |
| `towav.py` | the MP3s as WAV in `build/` (git-ignored), for the mixer |
| `mix.mjs` | the soundtrack: the score cut to 33 bars, the narrator over it (the music ducks under him), the effects, a limiter |
| `sheet.py` | a contact sheet of recorded frames, to look the cut over |

## Making it

```bash
# 1. the pictures: 2640 frames to captures/trailer/hype3_NNNNN.jpg, and the cue sheet
#    (the dev server must allow captures: ALLOW_CAPTURE=true)
#    open http://localhost:8080/?hype3          (?hype3&rec=11-14 re-records shots 11 to 14 only;
#                                                ?hype3&cues writes only the cue sheet)
# 2. the sound
blender -b --factory-startup -P trailer/towav.py -- .
node trailer/mix.mjs
# 3. together
blender -b --factory-startup -P blender/encode_hype.py -- . SolCity_Trailer.mp4 hype3_ "$PWD/trailer/build/hype3_mix.wav" 0 5000
```

Everything sits on one grid: 90 BPM, a beat is 20 frames at 30 fps. The shots in `hype3.js` are
counted in beats, and so are the narrator's lines (`NARRATION`) and each shot's effects (`sfx`); the
recorder writes them all to `captures/trailer/hype3_cues.json` for the mixer. The score was generated
longer (117 s); `mix.mjs` keeps bars 4–21, 26–29, 32–39 and 42–44 of it.
