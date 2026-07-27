# 默认 DaoCloud 镜像；构建时可传 PYTHON_BASE_IMAGE（见 docker-compose.agents-lan.yml）
ARG PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

WORKDIR /app

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_RETRIES=10
ENV PIP_DEFAULT_TIMEOUT=120

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 3105

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3105"]
