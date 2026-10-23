"""
A contact sheet of recorded trailer frames, to look the cut over without playing it:
  blender -b --factory-startup -P trailer/sheet.py -- <repo root> <out.png> <frame> [frame ...]
(frames: captures/trailer/hype3_NNNNN.jpg; each tile labelled with its frame number)
"""
import bpy, os, sys
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
ROOT, OUT, frames = os.path.abspath(args[0]), args[1], [int(a) for a in args[2:]]
TW, TH, COLS = 480, 270, 4
rows = (len(frames) + COLS - 1) // COLS
sheet = np.zeros((rows * TH, COLS * TW, 4), dtype=np.float32)
sheet[..., 3] = 1
for i, f in enumerate(frames):
    p = os.path.join(ROOT, "captures", "trailer", f"hype3_{f:05d}.jpg")
    if not os.path.exists(p):
        continue
    img = bpy.data.images.load(p)
    img.scale(TW, TH)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(TH, TW, 4)
    r, c = divmod(i, COLS)
    # (Blender's pixels run bottom-up: the sheet is assembled the same way, rows from the bottom)
    rr = rows - 1 - r
    sheet[rr * TH:(rr + 1) * TH, c * TW:(c + 1) * TW] = px
    bpy.data.images.remove(img)
out = bpy.data.images.new("sheet", COLS * TW, rows * TH)
out.pixels = sheet.ravel()
out.filepath_raw = OUT
out.file_format = "PNG"
out.save()
print("sheet", OUT, len(frames))
