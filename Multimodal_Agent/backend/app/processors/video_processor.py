import logging
from pathlib import Path

from ..config import Settings

logger = logging.getLogger(__name__)


class VideoProcessor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.max_bytes = max(1, int(settings.max_video_mb)) * 1024 * 1024

    def validate(self, path: Path) -> tuple[bool, str]:
        if not path.is_file():
            return False, "文件不存在"
        if path.stat().st_size > self.max_bytes:
            return False, f"视频超过 {self.settings.max_video_mb}MB 限制"
        return True, "ok"

    def extract_keyframes(self, path: Path, max_frames: int | None = None) -> list[Path]:
        """OpenCV 均匀采样关键帧，保存为 JPEG。"""
        n = max_frames or max(1, int(self.settings.video_frame_sample))
        out_dir = path.parent / f"{path.stem}_frames"
        out_dir.mkdir(parents=True, exist_ok=True)
        frames: list[Path] = []
        try:
            import cv2
        except ImportError:
            logger.warning("opencv 不可用，跳过帧提取")
            return frames

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            return frames
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        duration = total / fps if fps > 0 and total > 0 else 0
        if duration > float(self.settings.max_video_duration_sec):
            cap.release()
            raise ValueError(f"视频时长超过 {self.settings.max_video_duration_sec} 秒")

        indices: list[int] = []
        if total <= n:
            indices = list(range(max(0, total)))
        else:
            step = max(1, total // n)
            indices = [min(total - 1, i * step) for i in range(n)]

        for i, idx in enumerate(indices):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                continue
            fp = out_dir / f"frame_{i:03d}.jpg"
            cv2.imwrite(str(fp), frame)
            frames.append(fp)
        cap.release()
        return frames

    def meta(self, path: Path) -> dict:
        try:
            import cv2

            cap = cv2.VideoCapture(str(path))
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            cap.release()
            duration = total / fps if fps > 0 else 0
            return {"frames": total, "fps": fps, "width": w, "height": h, "duration_sec": round(duration, 2)}
        except Exception:
            return {"duration_sec": None}
