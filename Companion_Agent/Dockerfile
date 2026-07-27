# 前端构建 + FastAPI 同端口（与 Tavern_Agent 同模式）
ARG NODE_BASE_IMAGE=docker.1ms.run/library/node:20-bullseye
ARG PYTHON_BASE_IMAGE=docker.1ms.run/library/python:3.12-slim

FROM ${NODE_BASE_IMAGE} AS frontend-build
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent 2>/dev/null || npm install --silent
COPY frontend/ ./
RUN rm -rf ./public/vrm 2>/dev/null || true
RUN npm run build

FROM ${PYTHON_BASE_IMAGE}
WORKDIR /companion/backend
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    API_HOST=0.0.0.0 \
    API_PORT=13115

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY data ../data
COPY live2d ../live2d
COPY --from=frontend-build /fe/dist ../frontend/dist

EXPOSE 13115
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "13115"]
