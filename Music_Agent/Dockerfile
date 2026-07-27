# 前端构建 + FastAPI（与 Tavern_Agent 同模式：单端口托管 dist）
# 基础镜像默认 Docker Hub：部分镜像站（如 docker.1ms.run）曾对 python 出现 manifest 与 layer blob 不一致 → build 报 not found。
# 需国内镜像拉取时：compose / build 传入 NODE_BASE_IMAGE、PYTHON_BASE_IMAGE（完整镜像名含 registry）。
# 两个 ARG 必须出现在首个 FROM 之前，否则多阶段解析时第二个 FROM 会报 ARG 未声明。
ARG NODE_BASE_IMAGE=node:20-bullseye
# 3.10：spleeter 2.4.x 要求 <3.11；basic-pitch / TensorFlow 同镜像安装
ARG PYTHON_BASE_IMAGE=python:3.10-slim-bookworm
FROM ${NODE_BASE_IMAGE} AS frontend-build
WORKDIR /fe
# 国内构建可加速（与宿主 npm 配置无关，仅影响镜像内）
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent 2>/dev/null || npm install --silent
COPY frontend/ ./
RUN npm run build

# 固定 bookworm，避免 slim 默认随 Debian 大版本漂移导致 apt 包名（如 libpng）不一致
FROM ${PYTHON_BASE_IMAGE}
WORKDIR /music/backend
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# Debian 官方源在国内构建时常中途断连（Unable to connect to deb.debian.org）。
# 默认换清华镜像；海外或需官方源时构建覆盖，例如：
#   --build-arg APT_DEBIAN_MIRROR=https://deb.debian.org/debian --build-arg APT_SECURITY_MIRROR=https://security.debian.org/debian-security
ARG APT_DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
RUN set -eux; \
    printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n' \
        > /etc/apt/apt.conf.d/99agent-retries; \
    if [ -n "${APT_DEBIAN_MIRROR}" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
        [ -f "$f" ] || continue; \
        sed -i "s|http://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" "$f"; \
        sed -i "s|https://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" "$f"; \
      done; \
    fi; \
    if [ -n "${APT_SECURITY_MIRROR}" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
        [ -f "$f" ] || continue; \
        sed -i "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" "$f"; \
        sed -i "s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" "$f"; \
      done; \
    fi

# FluidSynth + Debian 自带 GM 音色库（FluidR3），无需挂载本机 .sf2 即可 MIDI→WAV
# music21 会拉取 matplotlib/numpy 等；无显示设备时需 Agg + 基础图形库，否则部分解析/写谱会崩
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fluidsynth \
        ffmpeg \
        fluid-soundfont-gm \
        ca-certificates \
        libfreetype6 \
        libpng16-16 \
        libsndfile1 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
# 默认清华 PyPI；官方源在国内常极慢（music21 ~20MB 会像卡住）。构建时覆盖：
#   docker build --build-arg PIP_INDEX_URL=https://pypi.org/simple .
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir --timeout=180 \
    -i "${PIP_INDEX_URL}" \
    -r requirements.txt

# Phase 1 瘦身：默认不装 Spleeter / Basic Pitch（音频重演绎已下线）。
ARG INSTALL_REMIX_DEPS=0
COPY backend/requirements-remix.txt .
RUN if [ "${INSTALL_REMIX_DEPS}" = "1" ]; then \
      python -c "import sys; v=sys.version_info[:2]; assert v==(3,10), f'spleeter 需 Python 3.10，当前 {sys.version}'" \
      && pip install --no-cache-dir --timeout=600 -i "${PIP_INDEX_URL}" "spleeter==2.4.2" \
      && python -c "from spleeter.separator import Separator; Separator('spleeter:2stems')" \
      && pip install --no-cache-dir --timeout=600 -i "${PIP_INDEX_URL}" \
          "basic-pitch[onnx]==0.4.0" "onnxruntime>=1.16.0" "typing_extensions>=4.12.0" \
      && pip install --no-cache-dir --force-reinstall -i "${PIP_INDEX_URL}" \
          "httpx>=0.27.2,<0.29" "httpcore>=1.0.0" "openai>=1.55.0" "typing_extensions>=4.12.0" \
      && python -c "import httpx; from openai import OpenAI; print('remix deps ok')"; \
    else \
      echo "Skipping Spleeter/Basic Pitch (INSTALL_REMIX_DEPS=0)"; \
    fi

# Phase 3：Demucs 分轨（CPU）；神经 BGM 默认不装以缩小镜像
ARG INSTALL_DEMUCS=1
ARG INSTALL_NEURAL_DEPS=0
# GPU 宿主机构建示例：--build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
COPY backend/requirements-audio.txt backend/requirements-neural.txt ./
RUN if [ "${INSTALL_DEMUCS}" = "1" ]; then \
      pip install --no-cache-dir --timeout=900 \
        torch torchaudio --index-url "${TORCH_INDEX_URL}" \
      && pip install --no-cache-dir --timeout=600 -i "${PIP_INDEX_URL}" -r requirements-audio.txt \
      && python -c "import demucs; print('demucs ok')"; \
    else \
      echo "Skipping Demucs (INSTALL_DEMUCS=0)"; \
    fi
RUN if [ "${INSTALL_NEURAL_DEPS}" = "1" ]; then \
      pip install --no-cache-dir --timeout=900 \
        torch torchaudio --index-url "${TORCH_INDEX_URL}" \
      && pip install --no-cache-dir --timeout=600 -i "${PIP_INDEX_URL}" -r requirements-neural.txt \
      && python -c "import torch; from transformers import MusicgenForConditionalGeneration; print('neural ok', torch.__version__)"; \
    else \
      echo "Skipping neural deps (INSTALL_NEURAL_DEPS=0)"; \
    fi

# 构建期校验：避免镜像打出后才发现 music21 未装上或依赖残缺
RUN python -c "import music21; from music21 import converter, stream; print('music21', music21.VERSION_STR, 'import ok')"

COPY backend/app ./app
COPY --from=frontend-build /fe/dist /music/frontend/dist

# 单容器：API + 静态前端（main.py 在 MUSIC_FRONTEND_DIST 非空时 mount "/"）
# Docker 默认关「思考流」、开 WAV（与本地 .env 常用手感一致）；compose 可覆盖
ENV MUSIC_FRONTEND_DIST=/music/frontend/dist \
    API_PORT=13110 \
    CORS_ORIGINS=http://localhost:13110,http://127.0.0.1:13110 \
    STREAM_MODEL_THINKING=false \
    MIDI_RENDER_WAV=true \
    SOUNDFONT_SF2_PATH=/usr/share/sounds/sf2/FluidR3_GM.sf2 \
    MPLBACKEND=Agg \
    ENABLE_MUSIC_THEORY=true \
    ENABLE_DEMUCS_STEMS=true \
    HF_HOME=/music/.cache/huggingface \
    TRANSFORMERS_CACHE=/music/.cache/huggingface \
    TORCH_HOME=/music/.cache/torch

# 仍可将宿主 .sf2 挂到 /music/.data/soundfonts，并在运行时设 SOUNDFONT_SF2_PATH 覆盖
RUN mkdir -p /music/.data/soundfonts /music/.data/music/out \
    /music/.cache/huggingface /music/.cache/torch

EXPOSE 13110
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${API_PORT:-13110}"]
