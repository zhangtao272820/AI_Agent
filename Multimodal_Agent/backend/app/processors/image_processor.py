import base64
from io import BytesIO
from pathlib import Path

from PIL import Image

from ..config import Settings, resolve_proj_path


class ImageProcessor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.max_bytes = max(1, int(settings.max_image_mb)) * 1024 * 1024

    def validate(self, path: Path) -> tuple[bool, str]:
        if not path.is_file():
            return False, "文件不存在"
        if path.stat().st_size > self.max_bytes:
            return False, f"图片超过 {self.settings.max_image_mb}MB 限制"
        try:
            with Image.open(path) as im:
                w, h = im.size
                if w > 8000 or h > 8000:
                    return False, "图片尺寸过大"
        except Exception as e:
            return False, f"无法解码图片: {e}"
        return True, "ok"

    def prepare_for_vl(self, path: Path, max_edge: int = 1280) -> Path:
        """压缩大图再送 VL，降低上传体积与等待时间。"""
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                w, h = im.size
                edge = max(w, h)
                if edge <= max_edge:
                    return path
                scale = max_edge / edge
                nw, nh = int(w * scale), int(h * scale)
                out = path.parent / f"{path.stem}_vl.jpg"
                im.resize((nw, nh), Image.Resampling.LANCZOS).save(out, "JPEG", quality=88)
                return out
        except Exception:
            return path

    def to_base64(self, path: Path) -> str:
        raw = path.read_bytes()
        return base64.b64encode(raw).decode("ascii")

    def save_upload(self, data: bytes, filename: str) -> Path:
        root = resolve_proj_path(self.settings.upload_dir)
        root.mkdir(parents=True, exist_ok=True)
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[-120:]
        dest = root / safe
        dest.write_bytes(data)
        return dest
