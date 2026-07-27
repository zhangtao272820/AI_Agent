from PIL import Image, ImageFile
from pathlib import Path
import numpy as np

ImageFile.LOAD_TRUNCATED_IMAGES = False

paths = [
    r"e:\Agent\Companion_Agent\data\sprites\romance\ruolin\sad.png",
    r"e:\Agent\Companion_Agent\data\sprites\romance\yeyu\neutral.png",
    r"e:\Agent\Companion_Agent\data\sprites\neutral\aichen\angry.png",
    r"e:\Agent\Companion_Agent\data\sprites\romance\jingning\neutral.png",
    r"e:\Agent\Companion_Agent\data\sprites\neutral\lingke\neutral.png",
]
for s in paths:
    p = Path(s)
    if not p.is_file():
        # try romance for jingning - jingning is neutral cast
        print("missing", s)
        continue
    try:
        with Image.open(p) as im:
            im.load()
            a = np.asarray(im.convert("RGBA"))[:, :, 3]
            print("OK", p.parent.name + "/" + p.name, im.size, im.mode, "amin", int(a.min()))
    except Exception as e:
        print("FAIL", p, e)
