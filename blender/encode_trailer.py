"""
Encodes the recorded trailer frames (captures/trailer/f*.jpg, 30 fps, 1280x720) with the
music track into an MP4 (H.264 + AAC) using Blender's video sequence editor.

  blender -b --factory-startup -P blender/encode_trailer.py -- <root> <music> <out.mp4>
"""
import bpy, os, sys

args = sys.argv[sys.argv.index("--") + 1:]
ROOT, MUSIC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1]), os.path.abspath(args[2])
FRAMES = os.path.join(ROOT, "captures", "trailer")
files = sorted(f for f in os.listdir(FRAMES) if f.endswith(".jpg"))
n = len(files)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1280, 720, 100
sc.frame_start, sc.frame_end = 1, n
ed = sc.sequence_editor_create()
strips = ed.strips if hasattr(ed, "strips") else ed.sequences
img = strips.new_image("frames", os.path.join(FRAMES, files[0]), channel=1, frame_start=1)
for f in files[1:]:
    img.elements.append(f)
# the track is a seamless loop: repeat it until the video is covered
start, k = 1, 0
while start <= n:
    snd = strips.new_sound(f"music{k}", MUSIC, channel=2 + (k % 2), frame_start=start)
    length = snd.frame_final_end - snd.frame_final_start
    start += length
    k += 1
# fade the music out over the last second
snd.volume = 1.0
snd.keyframe_insert("volume", frame=n - 30)
snd.volume = 0.0
snd.keyframe_insert("volume", frame=n)
print("MUSIC strips", k)

r = sc.render
# Blender 5 moved video output to media_type
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "VIDEO"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = 15
r.ffmpeg.audio_codec = "AAC"
r.ffmpeg.audio_bitrate = 192
r.ffmpeg.audio_channels = "STEREO"
r.use_sequencer = True
r.filepath = OUT
bpy.ops.render.render(animation=True)
print("ENCODED", OUT, n, "frames")
