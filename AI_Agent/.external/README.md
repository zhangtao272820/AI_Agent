# 可选外部对口型引擎（挂载到 Docker，不提交 git）

```
.external/
├── Wav2Lip/          # git clone Rudrabha/Wav2Lip + checkpoints/
└── MuseTalk/         # git clone TMElyralab/MuseTalk + download_weights
```

Compose 默认挂载：

- `Wav2Lip` → 容器 `/opt/Wav2Lip`
- `MuseTalk` → 容器 `/opt/MuseTalk`

可通过 `WAV2LIP_HOST_PATH` / `MUSETALK_HOST_PATH` 覆盖宿主机路径。
