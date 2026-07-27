"""Ultralight 流式推理（基于 dihuman_run.py，支持 CPU/CUDA）。"""

from __future__ import annotations

import logging
import math
import os
from collections.abc import Callable
from typing import List, Optional, Tuple

import cv2
import kaldi_native_fbank as knf
import numpy as np
import onnxruntime

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
FRAME_LEN = 160
WENET_TRIGGER_LEN = 11040
WENET_CHUNK_DROP = 800
MEL_BINS = 80
WENET_FEAT_FRAMES = 67
PRE_AUDIO_LEN = 32 * FRAME_LEN
PLAY_PRE_PAD = 13440
SILENCE_THRESHOLD = 100
UNET_FEAT_WINDOW = 8
USING_FEAT_INIT = 4
IDLE_LOOP = 5
DEFAULT_FPS = 20


def _make_fbank_opts() -> knf.FbankOptions:
    opts = knf.FbankOptions()
    opts.frame_opts.dither = 0
    opts.frame_opts.snip_edges = False
    opts.mel_opts.num_bins = MEL_BINS
    opts.mel_opts.debug_mel = False
    return opts


_FBANK_OPTS = _make_fbank_opts()


def _read_landmarks_to_bbox(lms_path: str) -> Tuple[int, int, int, int]:
    pts = []
    with open(lms_path, "r", encoding="utf-8") as f:
        for line in f.read().splitlines():
            line = line.strip()
            if not line:
                continue
            pts.append(np.fromstring(line, sep=" ", dtype=np.float32))
    lms = np.array(pts, dtype=np.int32)
    xmin = int(lms[1][0])
    ymin = int(lms[52][1])
    xmax = int(lms[31][0])
    ymax = ymin + (xmax - xmin)
    return xmin, ymin, xmax, ymax


def _build_unet_inputs(crop_img: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    crop_ori = crop_img.copy()
    inner = crop_img[4:164, 4:164].copy()
    masked = cv2.rectangle(inner.copy(), (5, 5, 150, 145), (0, 0, 0), -1)
    masked = masked.transpose(2, 0, 1).astype(np.float32) / 255.0
    inner = inner.transpose(2, 0, 1).astype(np.float32) / 255.0
    onnx_in = np.concatenate(
        (np.expand_dims(inner, 0), np.expand_dims(masked, 0)),
        axis=1,
    )
    return onnx_in, crop_ori


class _BounceIndex:
    def __init__(self, n_frames: int):
        assert n_frames >= 2
        self.n_frames = n_frames
        self.index = 0
        self.step = 1

    def advance(self):
        self.index += self.step
        if self.index >= self.n_frames - 1:
            self.step = -1
        elif self.index <= 0:
            self.step = 1


def _onnx_providers(prefer_cuda: bool = True) -> list[str]:
    avail = onnxruntime.get_available_providers()
    if prefer_cuda and "CUDAExecutionProvider" in avail:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def ultralight_ready(data_path: str) -> bool:
    p = os.path.join(data_path, "img_inference")
    lms = os.path.join(data_path, "lms_inference")
    unet = os.path.join(data_path, "unet.onnx")
    enc = os.path.join(data_path, "encoder.onnx")
    if not all(os.path.isdir(x) for x in (p, lms)):
        return False
    if not all(os.path.isfile(x) for x in (unet, enc)):
        return False
    return len(os.listdir(lms)) >= 2


class DiHumanProcessor:
    def __init__(self, data_path: str, *, prefer_cuda: bool = True):
        self.full_body_img_dir = os.path.join(data_path, "img_inference")
        self.lms_dir = os.path.join(data_path, "lms_inference")

        self.full_body_img_list: List[np.ndarray] = []
        self.bbox_list: List[Tuple[int, int, int, int]] = []
        n_frames = len(os.listdir(self.lms_dir)) - 1
        for i in range(n_frames):
            img = cv2.imread(os.path.join(self.full_body_img_dir, f"{i}.jpg"))
            if img is None:
                raise RuntimeError(f"无法读取 img_inference/{i}.jpg")
            self.full_body_img_list.append(img)
            bbox = _read_landmarks_to_bbox(os.path.join(self.lms_dir, f"{i}.lms"))
            self.bbox_list.append(bbox)

        providers = _onnx_providers(prefer_cuda)
        logger.info("Ultralight ONNX providers=%s", providers)
        self.ort_unet = onnxruntime.InferenceSession(
            os.path.join(data_path, "unet.onnx"), providers=providers
        )
        self.ort_ae = onnxruntime.InferenceSession(
            os.path.join(data_path, "encoder.onnx"), providers=providers
        )

        self.offset = np.ones((1,), dtype=np.int64) * 100
        self.att_cache = np.zeros([3, 8, 16, 128], dtype=np.float32)
        self.cnn_cache = np.zeros([3, 1, 512, 14], dtype=np.float32)

        self.frame_picker = _BounceIndex(len(self.bbox_list))
        self.audio_play_list: List[int] = [0] * PLAY_PRE_PAD
        self.audio_queue_get_feat = np.zeros([PRE_AUDIO_LEN], dtype=np.int16)
        self.using_feat = np.zeros([USING_FEAT_INIT, 16, 512], dtype=np.float32)

        self.counter = 0
        self.empty_audio_counter = 56
        self.is_processing = False
        self.silence = True

    def reset(self):
        self.audio_queue_get_feat = np.zeros([PRE_AUDIO_LEN], dtype=np.int16)
        self.audio_play_list = [0] * PLAY_PRE_PAD
        self.counter = 0
        self.is_processing = True

    def _detect_silence(self, audio_frame: np.ndarray):
        if not np.any(audio_frame):
            if not self.silence:
                self.empty_audio_counter += 1
                if self.empty_audio_counter >= SILENCE_THRESHOLD:
                    self.silence = True
        else:
            self.empty_audio_counter = 0
            self.silence = False

    def _next_idle_img(self) -> Tuple[Optional[np.ndarray], int]:
        if self.counter == 0:
            img = self.full_body_img_list[self.frame_picker.index].copy()
            self.frame_picker.advance()
            self.counter = 1
            return img, 1
        self.counter += 1
        if self.counter == IDLE_LOOP:
            self.counter = 0
        return None, 0

    def _pop_play_audio(self) -> np.ndarray:
        if self.audio_play_list:
            audio = np.array(self.audio_play_list[:FRAME_LEN], dtype=np.int16)
            self.audio_play_list = self.audio_play_list[FRAME_LEN:]
            return audio
        return np.zeros([FRAME_LEN], dtype=np.int16)

    def _run_encoder(self) -> np.ndarray:
        fbank = knf.OnlineFbank(_FBANK_OPTS)
        fbank.accept_waveform(SAMPLE_RATE, self.audio_queue_get_feat.tolist())
        self.audio_play_list.extend(
            self.audio_queue_get_feat[PRE_AUDIO_LEN : PRE_AUDIO_LEN + 800]
        )
        mel = np.array([[fbank.get_frame(i) for i in range(fbank.num_frames_ready)]])
        mel = mel[:, :, :WENET_FEAT_FRAMES, :]
        inputs = {
            "chunk": mel.astype(np.float32),
            "offset": self.offset,
            "att_cache": self.att_cache.astype(np.float32),
            "cnn_cache": self.cnn_cache.astype(np.float32),
        }
        outs = self.ort_ae.run(None, inputs)
        return outs[0]

    def _run_unet(self, img: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
        xmin, ymin, xmax, ymax = bbox
        crop_img = img[ymin:ymax, xmin:xmax]
        h, w = crop_img.shape[:2]
        crop_img = cv2.resize(crop_img, (168, 168))
        onnx_in, crop_ori = _build_unet_inputs(crop_img)
        audio_feat = self.using_feat.reshape(1, 128, 16, 32)
        inputs = {
            self.ort_unet.get_inputs()[0].name: onnx_in,
            self.ort_unet.get_inputs()[1].name: audio_feat,
        }
        outs = self.ort_unet.run(None, inputs)
        pred = (outs[0][0].transpose(1, 2, 0) * 255).astype(np.uint8)
        crop_ori[4:164, 4:164] = pred
        crop_ori = cv2.resize(crop_ori, (w, h))
        img[ymin:ymax, xmin:xmax] = crop_ori
        return img

    def process(self, audio_frame: np.ndarray):
        audio_frame = audio_frame.astype(np.int16)
        self._detect_silence(audio_frame)

        if self.silence:
            self.audio_queue_get_feat = np.array([], dtype=np.int16)
            self.is_processing = False
            return_img, check_img = self._next_idle_img()
            return return_img, np.zeros([FRAME_LEN], dtype=np.int16), check_img

        if not self.is_processing:
            self.reset()
        if audio_frame.shape[0] < FRAME_LEN:
            audio_frame = np.pad(audio_frame, (0, FRAME_LEN - audio_frame.shape[0]))
        self.audio_queue_get_feat = np.concatenate(
            [self.audio_queue_get_feat, audio_frame], axis=0
        )

        if self.audio_queue_get_feat.shape[0] >= WENET_TRIGGER_LEN:
            audio_feat = self._run_encoder()
            self.audio_queue_get_feat = self.audio_queue_get_feat[WENET_CHUNK_DROP:]
            self.using_feat = np.concatenate([self.using_feat, audio_feat], axis=0)

            img = self.full_body_img_list[self.frame_picker.index].copy()
            bbox = self.bbox_list[self.frame_picker.index]
            self.frame_picker.advance()

            if self.using_feat.shape[0] >= UNET_FEAT_WINDOW:
                img = self._run_unet(img, bbox)
                self.using_feat = self.using_feat[1:]

            self.counter = 1
            return img.copy(), self._pop_play_audio(), 1

        return_img, check_img = self._next_idle_img()
        return return_img, self._pop_play_audio(), check_img


def stream_pcm(
    data_path: str,
    pcm_int16: np.ndarray,
    *,
    prefer_cuda: bool = True,
    on_frame: Callable[[int, np.ndarray], None] | None = None,
    jpeg_quality: int = 82,
) -> tuple[list[np.ndarray], np.ndarray, tuple[int, int]]:
    """流式处理 16kHz PCM，返回 (frames, out_pcm, (w,h))。"""
    processor = DiHumanProcessor(data_path, prefer_cuda=prefer_cuda)
    frames: list[np.ndarray] = []
    audio_out: list[np.ndarray] = []
    n_chunks = math.ceil(max(1, pcm_int16.shape[0]) / FRAME_LEN)

    for i in range(n_chunks):
        a = i * FRAME_LEN
        b = min(a + FRAME_LEN, pcm_int16.shape[0])
        chunk = pcm_int16[a:b]
        if chunk.shape[0] < FRAME_LEN:
            chunk = np.pad(chunk, (0, FRAME_LEN - chunk.shape[0]))
        img, playing_audio, check_img = processor.process(chunk)
        audio_out.append(playing_audio)
        if check_img and img is not None:
            frames.append(img)
            if on_frame:
                ok, buf = cv2.imencode(
                    ".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]
                )
                if ok:
                    on_frame(len(frames) - 1, buf.tobytes())

    if not frames:
        raise RuntimeError("Ultralight 未输出任何视频帧，请检查数据集与音频")

    h, w = frames[0].shape[:2]
    out_pcm = np.concatenate(audio_out).astype(np.int16) if audio_out else pcm_int16
    return frames, out_pcm, (w, h)


def write_video(frames: list[np.ndarray], out_path: str, *, fps: int = DEFAULT_FPS) -> None:
    h, w = frames[0].shape[:2]
    writer = cv2.VideoWriter(
        out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)
    )
    for fr in frames:
        writer.write(fr)
    writer.release()
