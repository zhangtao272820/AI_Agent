from PIL import Image, ImageFile
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(r"e:\Agent\Companion_Agent\scripts")))
from normalize_sprite_canvas import normalize_image, CANVAS

ImageFile.LOAD_TRUNCATED_IMAGES = True

formal = Path(r"e:\Agent\Companion_Agent\data\sprites\romance\ruolin\sad.png")
bak = Path(r"e:\Agent\Companion_Agent\data\sprites\_archive\pre_unify\romance\ruolin\sad.png")

# Restore from backup if formal broken
src = bak if bak.is_file() else formal
print("reading", src, "size_bytes", src.stat().st_size)
with Image.open(src) as im:
    im.load()
    print("src", im.size, im.mode)
    out = normalize_image(im)
out = out.convert("RGBA")
out.save(formal, format="PNG", optimize=True, compress_level=6)
with Image.open(formal) as check:
    a = check.convert("RGBA").getextrema()[3]
    print("saved", check.size, check.mode, "alpha_extrema", a)
