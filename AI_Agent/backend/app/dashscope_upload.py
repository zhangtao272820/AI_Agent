"""百炼临时存储：上传本地字节并返回 oss:// URL。"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

import httpx

from .config import Settings, api_key

logger = logging.getLogger(__name__)

UPLOAD_POLICY_URL = "https://dashscope.aliyuncs.com/api/v1/uploads"


def upload_bytes(
    settings: Settings,
    *,
    model_name: str,
    data: bytes,
    filename: str,
) -> str:
    """
    上传文件到百炼临时 OSS，返回 oss://... URL。
    调用 wan 等接口时需在 Header 加 X-DashScope-OssResourceResolve: enable。
    """
    key = api_key(settings)
    if not key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY")

    safe_name = Path(filename).name or f"upload-{uuid.uuid4().hex[:8]}"
    with httpx.Client(timeout=120.0) as client:
        policy_rsp = client.get(
            UPLOAD_POLICY_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            params={"action": "getPolicy", "model": model_name},
        )
        if policy_rsp.status_code != 200:
            raise RuntimeError(f"获取上传凭证失败: {policy_rsp.text}")
        policy = policy_rsp.json().get("data") or {}
        upload_dir = policy.get("upload_dir", "")
        upload_host = policy.get("upload_host", "")
        if not upload_dir or not upload_host:
            raise RuntimeError("上传凭证缺少 upload_dir / upload_host")

        object_key = f"{upload_dir}/{safe_name}"
        files = {
            "OSSAccessKeyId": (None, policy.get("oss_access_key_id", "")),
            "Signature": (None, policy.get("signature", "")),
            "policy": (None, policy.get("policy", "")),
            "x-oss-object-acl": (None, policy.get("x_oss_object_acl", "private")),
            "x-oss-forbid-overwrite": (None, policy.get("x_oss_forbid_overwrite", "true")),
            "key": (None, object_key),
            "success_action_status": (None, "200"),
            "file": (safe_name, data),
        }
        up_rsp = client.post(upload_host, files=files)
        if up_rsp.status_code != 200:
            raise RuntimeError(f"上传 OSS 失败 ({up_rsp.status_code}): {up_rsp.text[:500]}")

    oss_url = f"oss://{object_key}"
    logger.info("已上传临时文件 model=%s name=%s", model_name, safe_name)
    return oss_url
