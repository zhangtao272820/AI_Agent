# Ultralight 推理数据集目录

将 Ultralight 官方流程从 `video/ai.mp4` 导出的推理素材放在此目录，供对口型微服务挂载为 `/data/ultralight`。

## 必需文件结构

```
ultralight_avatar/
├── img_inference/
│   ├── 0.jpg
│   ├── 1.jpg
│   └── ...
├── lms_inference/
│   ├── 0.lms
│   ├── 1.lms
│   └── ...
├── unet.onnx
└── encoder.onnx
```

## 生成步骤（概要）

1. 克隆 https://github.com/anliyuan/Ultralight-Digital-Human
2. 用 `AI_Agent/video/ai.mp4` 跑数据预处理（抽帧、人脸关键点）
3. 按官方 README 训练或加载 checkpoint，导出 ONNX
4. 将 `img_inference/`、`lms_inference/`、`unet.onnx`、`encoder.onnx` 复制到本目录

完整 Docker 部署与硬件要求见 [`doc/ultralight-docker-setup.md`](../doc/ultralight-docker-setup.md)。

## 验证

```powershell
curl http://127.0.0.1:8091/health
# ultralight_ready 应为 true
```
