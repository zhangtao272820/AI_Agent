#!/usr/bin/env python3
"""Generate anonymous sexy female passerby sprites via DashScope Wanxiang T2I.

These are location decor only (data/sprites/_background/), not named cast.
Default: dry-run. Use --generate then --promote to register into background_extras.json.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
STAGING = ROOT / "data" / "sprites" / "_staging" / "passerby"
BG_ROOT = ROOT / "data" / "sprites" / "_background"
CATALOG = ROOT / "data" / "background_extras.json"
CANVAS = (1024, 1536)

# 20 anonymous adult female passers — bold outfits, distinct looks, no named cast.
TASKS: list[dict[str, str]] = [
    {
        "id": "passerby_f01__street_lingerie_shy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人，互不撞脸，高颜值诱惑。"
            "黑色蕾丝内衣套装配吊带袜，曲线明显，遮挡充分不露点，害羞侧身站姿。"
            "长直黑发，精致五官。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "深V黑色吊带短裙，露肩腿，害羞站姿。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f02__street_deepv_happy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人，高颜值。"
            "鲜红深V紧身连衣裙，高开衩露腿，乳沟压线仍遮挡，自信微笑。"
            "波浪棕发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "红色低领紧身短裙，露腿，微笑。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f03__street_sheer_shy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "薄纱罩衫下可见黑色内衣轮廓，战略遮挡敏感部位不可辨，害羞捂胸姿势。"
            "银色短发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "半透薄纱外套+不透明短裙，害羞。禁止透视乳头、露点、文字水印。"
        ),
    },
    {
        "id": "passerby_f04__street_strappy_love",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "细带绑带蕾丝内衣套装，遮挡充分，心动仰视表情，站姿。"
            "粉挑染双马尾。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "细肩带短睡裙，露肩腿，心动表情。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f05__street_towel_shy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "白色浴巾裹身到大腿上，湿发披肩，双手抓紧浴巾角害羞，曲线贴合。"
            "亚麻色长发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "浴袍松系+湿发，露锁骨腿线，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f06__street_micro_slip_happy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "极短丝质吊带睡裙，大腿根将露未露，遮挡充分不露点，甜笑。"
            "金色及肩发。禁止露点、乳晕、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "丝质短吊带裙，露肩腿，甜笑。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f07__street_robe_open_shy",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "丝质睡袍敞开露出内衣套装，前襟仍遮挡充分，害羞。"
            "深蓝长直发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "丝质睡袍半敞+短睡裙，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f08__street_wet_cling_love",
        "loc": "street",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "雨天短风衣微敞+白色短袖衬衫+迷你裙，发梢微湿，心动表情。"
            "短黑发。禁止透视、露点、性器官、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "雨天白衬衫短裙持伞，发梢微湿，心动微笑。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f09__campus_cheer_shy",
        "loc": "campus",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "超短啦啦队服露腰与大腿，遮挡充分，害羞咬唇。"
            "高马尾红发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "短款啦啦队服，露腰腿，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f10__campus_gym_happy",
        "loc": "campus",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "运动短背心+超短裤，丰满身材曲线，汗光，开朗笑。"
            "棕色马尾。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "运动背心短裤，活力笑。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f11__campus_uniform_sexy_shy",
        "loc": "campus",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "改短水手服超短裙，解开领口露锁骨轻乳沟，害羞。"
            "黑长直发。禁止露点、性器官、性行为姿势、未成年幼化、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "短裙校服微敞领，害羞。禁止幼化、露点、文字水印。"
        ),
    },
    {
        "id": "passerby_f12__campus_bikini_cover_love",
        "loc": "campus",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "比基尼外罩敞开衬衫，遮挡充分，心动回眸。"
            "浅紫短发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女大学生路人。"
            "泳装外罩衬衫，心动。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f13__office_secretary_deepv_shy",
        "loc": "office",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "紧身深V白衬衫+超短铅笔裙，丝袜，夹文件夹，害羞。"
            "盘发眼镜。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "低领衬衫短裙丝袜，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f14__office_afterhours_lingerie_love",
        "loc": "office",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "下班后蕾丝吊带睡裙，外套半褪挂肘，心动表情。"
            "酒红波浪发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "蕾丝短睡裙，外套挂肘，心动。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f15__office_garter_shy",
        "loc": "office",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "衬衫解开到胸前仍遮挡+蕾丝吊带袜袜夹，微抬腿站姿，害羞。"
            "金色盘发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "短裙衬衫+吊带袜，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f16__office_qipao_slit_happy",
        "loc": "office",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "高开衩改良旗袍，侧腿一线，胸线明显仍遮挡，甜笑。"
            "黑旗袍发髻。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年职业女性路人。"
            "高开衩旗袍，甜笑。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f17__home_morning_shirt_shy",
        "loc": "home",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "男友风白衬衫半敞到大腿，内仅内衣，遮挡充分，晨起害羞。"
            "凌乱浅棕长发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "过大白衬衫到大腿，害羞。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f18__home_lace_night_love",
        "loc": "home",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "粉色蕾丝吊带睡裙+薄纱，抱靠枕，心动亲昵。"
            "粉色长发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "粉色短睡裙抱枕，心动。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f19__home_kneel_pillow_shy",
        "loc": "home",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "跪坐抱枕挡胸，内衣轮廓被遮，仰视害羞，非性行为姿势。"
            "黑短发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "跪坐抱大靠枕，短睡裙，害羞仰视。禁止露点与文字水印。"
        ),
    },
    {
        "id": "passerby_f20__home_back_glance_love",
        "loc": "home",
        "prompt": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "露背睡裙回眸，肩带将落未落，遮挡充分，心动。"
            "栗色长卷发。禁止露点、性器官、性行为姿势、未成年、文字水印。"
        ),
        "soft": (
            "全黑背景动漫视觉小说全身立绘，成年女性路人。"
            "露背短睡裙回眸，心动。禁止露点与文字水印。"
        ),
    },
]


def load_dotenv_key() -> str:
    env_path = ROOT / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == "DASHSCOPE_API_KEY" and v.strip():
                os.environ.setdefault("DASHSCOPE_API_KEY", v.strip().strip('"').strip("'"))
    return (os.environ.get("DASHSCOPE_API_KEY") or "").strip()


def _http_json(method: str, url: str, *, headers: dict[str, str], body: dict | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


def _poll_task(task_id: str, *, api_key: str) -> str:
    task_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
    poll_headers = {"Authorization": f"Bearer {api_key}"}
    for _ in range(90):
        time.sleep(2)
        polled = _http_json("GET", task_url, headers=poll_headers)
        output = polled.get("output") or {}
        status = str(output.get("task_status") or "")
        if status == "SUCCEEDED":
            results = output.get("results") or []
            if not results:
                raise RuntimeError(f"no results: {polled}")
            url = str(results[0].get("url") or "")
            if not url:
                raise RuntimeError(f"empty url: {polled}")
            return url
        if status in {"FAILED", "CANCELED", "UNKNOWN"}:
            raise RuntimeError(f"task {status}: {polled}")
    raise RuntimeError(f"timeout polling {task_id}")


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = resp.read()
    dest.write_bytes(raw)


def to_vn_canvas(src: Path, dest: Path) -> None:
    """Scale character to ~92% height, bottom-center on transparent 1024x1536."""
    import numpy as np

    im = Image.open(src).convert("RGBA")
    arr = np.asarray(im).copy()
    mx = arr[:, :, :3].max(axis=2)
    bg = (mx <= 18) & (arr[:, :, 3] > 200)
    arr[bg, 3] = 0
    keyed = Image.fromarray(arr, "RGBA")
    bbox = keyed.getbbox()
    if not bbox:
        keyed.save(dest)
        return
    cropped = keyed.crop(bbox)
    cw, ch = cropped.size
    target_h = int(CANVAS[1] * 0.92)
    scale = target_h / max(ch, 1)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    if nw > CANVAS[0]:
        scale = CANVAS[0] / cw
        nw = CANVAS[0]
        nh = max(1, int(ch * scale))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    x = (CANVAS[0] - nw) // 2
    y = CANVAS[1] - nh
    canvas.paste(resized, (x, y), resized)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")


def dashscope_t2i(prompt: str, *, api_key: str, model: str, size: str, dest: Path) -> None:
    create_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    body = {
        "model": model,
        "input": {"prompt": prompt[:800]},
        "parameters": {"size": size, "n": 1},
    }
    created = _http_json("POST", create_url, headers=headers, body=body)
    task_id = ((created.get("output") or {}).get("task_id")) or ""
    if not task_id:
        raise RuntimeError(f"no task_id: {created}")
    image_url = _poll_task(task_id, api_key=api_key)
    raw = dest.with_suffix(".raw.png")
    _download(image_url, raw)
    to_vn_canvas(raw, dest)
    raw.unlink(missing_ok=True)


def run_generate(*, limit: int, force: bool, model: str, size: str) -> list[str]:
    api_key = load_dotenv_key()
    if not api_key:
        raise SystemExit("DASHSCOPE_API_KEY missing (.env or env)")
    pending = TASKS[: limit if limit > 0 else len(TASKS)]
    done: list[str] = []
    for i, t in enumerate(pending, 1):
        dest = STAGING / f"{t['id']}.png"
        if dest.is_file() and not force:
            print(f"[{i}/{len(pending)}] skip exists {dest.name}")
            done.append(str(dest.relative_to(ROOT)).replace("\\", "/"))
            continue
        print(f"[{i}/{len(pending)}] {t['id']} …")
        try:
            dashscope_t2i(t["prompt"], api_key=api_key, model=model, size=size, dest=dest)
            done.append(str(dest.relative_to(ROOT)).replace("\\", "/"))
            print(f"  ok → {dest}")
        except Exception as ex:
            print(f"  FAIL bold: {ex}")
            try:
                print("  retry soft …")
                dashscope_t2i(t["soft"], api_key=api_key, model=model, size=size, dest=dest)
                done.append(str(dest.relative_to(ROOT)).replace("\\", "/"))
                print(f"  ok soft → {dest}")
            except Exception as ex2:
                print(f"  FAIL soft: {ex2}")
    return done


def run_promote() -> int:
    cat = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.is_file() else {}
    locations: dict[str, list] = cat.setdefault("locations", {})
    n = 0
    for t in TASKS:
        src = STAGING / f"{t['id']}.png"
        if not src.is_file():
            continue
        loc = t["loc"]
        dest = BG_ROOT / loc / f"{t['id']}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        file_rel = f"{loc}/{t['id']}.png"
        row = {
            "id": t["id"],
            "file": file_rel,
            "source": t["id"].split("__", 1)[0],
            "location": loc,
            "tag": "sexy_trial",
        }
        rows = locations.setdefault(loc, [])
        rows = [r for r in rows if r.get("id") != t["id"]]
        rows.append(row)
        locations[loc] = rows
        n += 1
        print(f"promoted {dest.relative_to(ROOT)}")
    cat["version"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cat.setdefault(
        "note",
        "无名路人装饰层（与 data/bgs 场景底图同类）：仅装饰地点场景，不可对话、无角色名。解锁：calendar.day_index >= unlock_day",
    )
    # Trial: show passers immediately (was 7). Raise again if too early-game noisy.
    cat["unlock_day"] = 1
    cat["root"] = "data/sprites/_background"
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {CATALOG.relative_to(ROOT)} (+{n})")
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="Wanxiang T2I sexy passerby → _background")
    ap.add_argument("--generate", action="store_true")
    ap.add_argument("--promote", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--model", default=os.environ.get("COMPANION_IMAGE_MODEL") or "wanx2.1-t2i-turbo")
    ap.add_argument("--size", default="720*1280", help="Wanxiang size, portrait preferred")
    args = ap.parse_args()

    print(f"tasks={len(TASKS)}")
    for t in TASKS:
        print(f"  {t['loc']}/{t['id']}.png")

    if args.promote:
        print(f"promoted {run_promote()} files")
        return

    if args.generate:
        done = run_generate(limit=args.limit, force=args.force, model=args.model, size=args.size)
        print(f"generated {len(done)} into {STAGING.relative_to(ROOT)}")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = STAGING / "_tasks" / f"passerby_{stamp}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"tasks": TASKS}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"dry-run wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
