import logging
from pathlib import Path

from ..config import Settings, resolve_proj_path

logger = logging.getLogger(__name__)


class AudioProcessor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.max_bytes = max(1, int(settings.max_audio_mb)) * 1024 * 1024

    def validate(self, path: Path) -> tuple[bool, str]:
        if not path.is_file():
            return False, "文件不存在"
        if path.stat().st_size > self.max_bytes:
            return False, f"音频超过 {self.settings.max_audio_mb}MB 限制"
        return True, "ok"

    def to_wav(self, path: Path) -> Path:
        """尽量转为 WAV 便于 ASR。"""
        if path.suffix.lower() == ".wav":
            return path
        out = path.with_suffix(".wav")
        try:
            from pydub import AudioSegment

            seg = AudioSegment.from_file(str(path))
            seg.export(str(out), format="wav")
            return out
        except Exception as ex:
            logger.warning("音频转 WAV 失败，使用原文件: %s", ex)
            return path

    def save_upload(self, data: bytes, filename: str) -> Path:
        root = resolve_proj_path(self.settings.upload_dir)
        root.mkdir(parents=True, exist_ok=True)
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[-120:]
        dest = root / safe
        dest.write_bytes(data)
        return dest
