from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.internal_auth import verify_internal_token
from app.core.learning_curator import get_learning_payload, run_learning_curator
from app.core.prompt_evolution import (
    auto_promote_eligible_patches,
    clear_evolved_hints,
    clear_prompt_patches,
    promote_prompt_patch,
    promote_min_hits,
)

router = APIRouter()


class PromoteBody(BaseModel):
    patchId: str | None = None
    auto: bool = False
    minHits: int | None = None


class CurateBody(BaseModel):
    autoPromote: bool = True
    minHits: int | None = None
    ingestAudit: bool = True


class ResetBody(BaseModel):
    scope: str = "shadow"  # shadow | evolved | all


@router.get("/api/learning")
async def learning_get(_: None = Depends(verify_internal_token)):
    return get_learning_payload()


@router.post("/api/learning/promote")
async def learning_promote(body: PromoteBody, _: None = Depends(verify_internal_token)):
    if body.auto:
        th = body.minHits if body.minHits is not None else promote_min_hits()
        promoted = auto_promote_eligible_patches(th)
        return {"ok": True, "promoted": promoted, "count": len(promoted)}
    patch_id = str(body.patchId or "").strip()
    if not patch_id:
        raise HTTPException(status_code=400, detail="请提供 patchId 或 auto=true")
    res = promote_prompt_patch(patch_id)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=str(res.get("reason") or "promote_failed"))
    return {"ok": True, "hintId": res.get("hintId"), "skillId": res.get("skillId")}


@router.post("/api/learning/curate")
async def learning_curate(body: CurateBody, _: None = Depends(verify_internal_token)):
    report = run_learning_curator(
        auto_promote=body.autoPromote,
        min_hits=body.minHits,
        ingest_audit=body.ingestAudit,
    )
    return {"ok": True, "report": report}


@router.post("/api/learning/reset")
async def learning_reset(body: ResetBody, _: None = Depends(verify_internal_token)):
    scope = str(body.scope or "shadow").strip().lower()
    if scope in ("shadow", "all"):
        clear_prompt_patches()
    if scope in ("evolved", "all"):
        clear_evolved_hints()
    return {"ok": True, "scope": scope}
