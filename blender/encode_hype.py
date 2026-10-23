"""
Encodes the hype trailer (captures/trailer/hype_*.jpg, 30 fps, 1280x720) with its music into
an MP4 (H.264 + AAC) using Blender's video sequence editor. The music is "Vessel of Eternity"
by tricksntraps (CC0, opengameart.org/content/free-rhythm-game-music-pack-1), 150 BPM, from
bar 128 (204.8 s): the recorder cuts on that beat grid.

  blender -b --factory-startup -P blender/encode_hype.py -- <root> [out.mp4] [prefix] [music.wav] [start s]

The second trailer (hype2.js): ... -- . SolCity_LastJob.mp4 hype2_ 4_the_lab.wav 253.41
The third (hype3.js, 1080p, its own finished soundtrack from trailer/mix.mjs):
  ... -- . SolCity_Trailer.mp4 hype3_ <repo>/trailer/build/hype3_mix.wav 0 5000
(the last number, if given: a fixed video bitrate in kbit/s, to keep a 1080p file under GitHub's 100 MB)
(a music path that is absolute is used as it is; the frames' size sets the video's)
"""
import bpy, os, sys

args = sys.argv[sys.argv.index("--") + 1:]
ROOT = os.path.abspath(args[0])
OUT = os.path.abspath(args[1]) if len(args) > 1 else os.path.join(ROOT, "SolCity_Hype.mp4")
PREFIX = args[2] if len(args) > 2 else "hype_"
MUSIC = os.path.join(ROOT, "vendor", "music", "rhythm_pack", args[3] if len(args) > 3 else "9_vessel_of_eternity.wav")
START = float(args[4]) if len(args) > 4 else 128 * 4 * 60 / 150  # bar 128, in seconds
FRAMES = os.path.join(ROOT, "captures", "trailer")
files = sorted(f for f in os.listdir(FRAMES) if f.startswith(PREFIX) and f.endswith(".jpg"))
n = len(files)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
first = bpy.data.images.load(os.path.join(FRAMES, files[0]))
sc.render.resolution_x, sc.render.resolution_y = first.size
sc.render.resolution_percentage = 100
sc.frame_start, sc.frame_end = 1, n
ed = sc.sequence_editor_create()
strips = ed.strips if hasattr(ed, "strips") else ed.sequences
img = strips.new_image("frames", os.path.join(FRAMES, files[0]), channel=1, frame_start=1)
for f in files[1:]:
    img.elements.append(f)
# the track placed so that bar 128 lands on frame 1, trimmed to the video
off = round(START * 30)
snd = strips.new_sound("music", MUSIC, channel=2, frame_start=1 - off)
snd.frame_final_start = 1
snd.frame_final_end = n + 1
# a short fade at the very end (the picture fades to black with it)
snd.volume = 1.0
snd.keyframe_insert("volume", frame=n - 20)
snd.volume = 0.0
snd.keyframe_insert("volume", frame=n)

r = sc.render
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "VIDEO"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
if len(args) > 5:
    r.ffmpeg.constant_rate_factor = "NONE"
    r.ffmpeg.video_bitrate = int(args[5])
    r.ffmpeg.maxrate = int(int(args[5]) * 1.5)
    r.ffmpeg.minrate = 0
    r.ffmpeg.buffersize = 2 * int(args[5])
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = 15
r.ffmpeg.audio_codec = "AAC"
r.ffmpeg.audio_bitrate = 256
r.ffmpeg.audio_channels = "STEREO"
r.use_sequencer = True
r.filepath = OUT
bpy.ops.render.render(animation=True)
print("ENCODED", OUT, n, "frames")
