#!/bin/sh
set -eu

: "${LIPSYNC_PORT:=8091}"
: "${LIPSYNC_BACKEND:=ultralight}"
: "${ULTRALIGHT_DATA_PATH:=/data/ultralight}"
: "${LIPSYNC_FACE_VIDEO:=/app/video/ai.mp4}"

echo "[lipsync] backend=${LIPSYNC_BACKEND} cuda=${LIPSYNC_PREFER_CUDA:-true}"
echo "[lipsync] ultralight_data=${ULTRALIGHT_DATA_PATH}"
echo "[lipsync] face_video=${LIPSYNC_FACE_VIDEO}"

if [ -n "${WAV2LIP_ROOT:-}" ] && [ -d "${WAV2LIP_ROOT}" ]; then
  echo "[lipsync] wav2lip_root=${WAV2LIP_ROOT}"
fi
if [ -n "${MUSETALK_ROOT:-}" ] && [ -d "${MUSETALK_ROOT}" ]; then
  echo "[lipsync] musetalk_root=${MUSETALK_ROOT}"
fi

exec python server.py
