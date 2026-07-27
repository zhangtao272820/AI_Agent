import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .catalog import CHARACTERS, WINES, WINE_STAT_LABELS, get_wine_stats
from .chat_service import chat_once
from .config import get_settings, resolve_proj_path
from .image_service import (
    get_or_create_character_image,
    get_or_create_wine_image,
    resolve_image_provider,
)
from .matrix import compute_params, find_character, find_wine, params_to_dict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Agent Tavern API", version="0.1.0")
settings = get_settings()

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

asset_dir = resolve_proj_path(settings.asset_dir)
asset_dir.mkdir(parents=True, exist_ok=True)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "chat_model": settings.openai_model,
        "image_model": settings.tavern_image_model,
        "image_provider": resolve_image_provider(settings),
    }


@app.get("/api/catalog")
def catalog():
    out_wines = []
    for w in WINES:
        out_wines.append(
            {
                **w,
                "stats": get_wine_stats(w["id"]),
                "imageUrl": f"/api/images/wine/{w['id']}",
            }
        )
    out_chars = []
    for c in CHARACTERS:
        out_chars.append(
            {
                **c,
                "imageUrl": f"/api/images/character/{c['id']}",
            }
        )
    return {
        "wines": out_wines,
        "characters": out_chars,
        "wineStatLabels": WINE_STAT_LABELS,
    }


@app.get("/api/matrix/{character_id}/{wine_id}")
def matrix_preview(character_id: str, wine_id: str):
    if not find_wine(wine_id) or not find_character(character_id):
        raise HTTPException(404, "unknown wine or character")
    p = compute_params(wine_id, character_id)
    return {"behavior": params_to_dict(p)}


class ChatIn(BaseModel):
    wine_id: str
    character_id: str
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[dict[str, str]] | None = None


@app.post("/api/chat")
def chat(body: ChatIn):
    try:
        text, meta = chat_once(
            settings,
            wine_id=body.wine_id,
            character_id=body.character_id,
            user_message=body.message,
            history=body.history,
        )
        return {"reply": text, "meta": meta}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        logger.exception("chat failed")
        raise HTTPException(500, f"chat error: {e}") from e


@app.get("/api/images/wine/{wine_id}")
def wine_image(wine_id: str):
    if not find_wine(wine_id):
        raise HTTPException(404, "unknown wine")
    url = get_or_create_wine_image(settings, wine_id)
    if not url:
        raise HTTPException(503, "image generation unavailable")
    fname = url.rsplit("/", 1)[-1]
    path = asset_dir / fname
    if not path.exists():
        raise HTTPException(404, "image missing")
    return FileResponse(path, media_type="image/png")


@app.get("/api/images/character/{character_id}")
def character_image(character_id: str):
    if not find_character(character_id):
        raise HTTPException(404, "unknown character")
    url = get_or_create_character_image(settings, character_id)
    if not url:
        raise HTTPException(503, "image generation unavailable")
    fname = url.rsplit("/", 1)[-1]
    path = asset_dir / fname
    if not path.exists():
        raise HTTPException(404, "image missing")
    return FileResponse(path, media_type="image/png")


# 可选：直接静态访问（缓存命中后）
app.mount("/api/static", StaticFiles(directory=str(asset_dir)), name="static")

# Docker / 生产：同机托管前端 dist（/api 已注册，后挂 / 不抢匹配）
_dist = (settings.tavern_frontend_dist or "").strip()
if _dist:
    _dist_path = Path(_dist)
    if _dist_path.is_dir():
        app.mount("/", StaticFiles(directory=str(_dist_path), html=True), name="frontend")
    else:
        logger.warning("TAVERN_FRONTEND_DIST is set but not a directory: %s", _dist)
