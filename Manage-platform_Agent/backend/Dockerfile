# 国内构建：DaoCloud 基础镜像 + 清华 pip/apt（与 AI_admin / Music_Agent 一致）
ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

ARG APT_DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

# apt 换源 + 重试（避免 deb.debian.org 在国内超时）
RUN set -eux; \
    printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n' \
        > /etc/apt/apt.conf.d/99agent-retries; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
        [ -f "$f" ] || continue; \
        sed -i "s|http://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" "$f"; \
        sed -i "s|https://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" "$f"; \
        sed -i "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" "$f"; \
        sed -i "s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" "$f"; \
    done; \
    apt-get update; \
    apt-get install -y --no-install-recommends docker.io docker-compose; \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --timeout=180 -i "${PIP_INDEX_URL}" -r requirements.txt

COPY backend/app ./app
COPY skills-catalog ./skills-catalog

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
