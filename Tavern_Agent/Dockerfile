# 前端构建 + Python API 同端口（便于 LAN / Compose）
FROM docker.1ms.run/library/node:20-bullseye AS frontend-build
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent || npm install --silent
COPY frontend/ ./
RUN npm run build

FROM docker.1ms.run/library/python:3.12-slim
WORKDIR /tavern/backend
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    TAVERN_FRONTEND_DIST=/tavern/frontend/dist

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend-build /fe/dist /tavern/frontend/dist

EXPOSE 13109
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "13109"]
