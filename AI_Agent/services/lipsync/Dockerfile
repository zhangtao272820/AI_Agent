# AI_Agent 本地对口型微服务（Ultralight + Wav2Lip 回退）
# GPU：宿主机需安装 NVIDIA 驱动 + nvidia-container-toolkit，compose 中设 LIPSYNC_GPU=1
ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LIPSYNC_PORT=8091 \
    LIPSYNC_BACKEND=ultralight \
    LIPSYNC_PREFER_CUDA=true \
    ULTRALIGHT_DATA_PATH=/data/ultralight \
    LIPSYNC_FACE_VIDEO=/app/video/ai.mp4

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG APT_DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
# 1=安装 onnxruntime-gpu（需 NVIDIA 容器运行时）；0=CPU 版 onnxruntime
ARG LIPSYNC_GPU=0

RUN sed -i "s|deb.debian.org/debian|${APT_DEBIAN_MIRROR#https://}|g; s|security.debian.org/debian-security|${APT_SECURITY_MIRROR#https://}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i "s|deb.debian.org/debian|${APT_DEBIAN_MIRROR#https://}|g; s|security.debian.org/debian-security|${APT_SECURITY_MIRROR#https://}|g" /etc/apt/sources.list 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-docker.txt ./
RUN pip install --no-cache-dir -i "${PIP_INDEX_URL}" -r requirements-docker.txt && \
    if [ "${LIPSYNC_GPU}" = "1" ]; then \
      pip uninstall -y onnxruntime 2>/dev/null || true; \
      pip install --no-cache-dir -i "${PIP_INDEX_URL}" onnxruntime-gpu>=1.16.0; \
    fi

COPY *.py ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8091

HEALTHCHECK --interval=15s --timeout=8s --start-period=45s --retries=6 \
    CMD curl -fsS "http://127.0.0.1:${LIPSYNC_PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
