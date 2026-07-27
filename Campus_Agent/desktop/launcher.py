"""Windows desktop launcher: uvicorn + pywebview."""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


def _prepare_env() -> tuple[int, Path]:
    desktop_dir = Path(__file__).resolve().parent
    project = desktop_dir.parent
    if not getattr(sys, "frozen", False):
        os.environ.setdefault("CAMPUS_PROJECT_ROOT", str(project))
    os.environ["CAMPUS_DESKTOP"] = "1"

    backend = project / "backend"
    if backend.is_dir() and str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    if str(desktop_dir) not in sys.path:
        sys.path.insert(0, str(desktop_dir))
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        os.environ.setdefault("CAMPUS_PROJECT_ROOT", str(meipass))
        for p in (meipass, meipass / "backend", Path(sys.executable).resolve().parent):
            if p.is_dir() and str(p) not in sys.path:
                sys.path.insert(0, str(p))

    from paths import ensure_user_env, frontend_dist, user_data_dir

    env_file = ensure_user_env()
    if env_file and env_file.is_file():
        _load_dotenv(env_file)
    # writable saves under LOCALAPPDATA when desktop
    os.environ.setdefault("CAMPUS_USER_DATA", str(user_data_dir().parent))

    port = int(os.environ.get("CAMPUS_PORT", "0") or "0")
    if port <= 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = int(s.getsockname()[1])
    os.environ["CAMPUS_PORT"] = str(port)
    return port, frontend_dist()


def _run_server(port: int) -> None:
    import uvicorn
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


def _wait_ready(port: int, timeout: float = 25.0) -> dict | None:
    import json
    import urllib.request

    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/api/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    raw = resp.read().decode("utf-8", errors="replace")
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        return {"ok": True}
        except Exception:
            time.sleep(0.2)
    return None


def main() -> int:
    port, dist = _prepare_env()
    if not dist.is_dir():
        print(f"[Campus] frontend dist missing: {dist}", file=sys.stderr)
        print("Run: cd frontend && npm run build", file=sys.stderr)

    thread = threading.Thread(target=_run_server, args=(port,), daemon=True)
    thread.start()
    health = _wait_ready(port)
    if not health:
        print(f"[Campus] server failed to start on port {port}", file=sys.stderr)
        return 1

    key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("CAMPUS_API_KEY")
    if key:
        print("[Campus] 模型密钥已加载，可以对话。")
    else:
        local = os.environ.get("LOCALAPPDATA") or ""
        hint = f"{local}\\CampusAgent\\.env" if local else "%LOCALAPPDATA%\\CampusAgent\\.env"
        print(
            f"[Campus] 未检测到 API 密钥。可编辑 {hint} 填入 DASHSCOPE_API_KEY。无密钥仍可推进世界。",
            file=sys.stderr,
        )

    import webview
    from api import DesktopApi

    api = DesktopApi()
    window = webview.create_window(
        "人工学园",
        f"http://127.0.0.1:{port}/",
        width=1280,
        height=720,
        min_size=(1024, 640),
        background_color="#0f171c",
        js_api=api,
    )
    api.bind(window)
    webview.start(debug=bool(os.environ.get("CAMPUS_WEBVIEW_DEBUG")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
