# 业务配置见 AI_Agent/.env（运行时 env_file 注入），此处仅构建参数与运行骨架
ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-bullseye
ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim-bookworm
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

FROM ${NODE_BASE_IMAGE} AS frontend-build
WORKDIR /app/frontend
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
COPY video/ ../video/
RUN npm run build

FROM ${PYTHON_BASE_IMAGE}
WORKDIR /app/backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./requirements.txt
ARG PIP_INDEX_URL
RUN pip install --no-cache-dir -i "${PIP_INDEX_URL}" -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ../frontend/dist
EXPOSE 8080
# API_HOST / API_PORT 由 .env 经 compose env_file 注入
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${API_HOST:-0.0.0.0}\" --port \"${API_PORT:-8080}\""]
