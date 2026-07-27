import type { AvatarState, Live2dEmotionMapEntry, Live2dLayout, Live2dModelInfo } from "../types";

const DEFAULT_LAYOUT: Required<Live2dLayout> = {
  flip_x: true,
  fill_width: 0.72,
  fill_height: 0.94,
  anchor_x: 0.5,
  anchor_y: 1,
  x_ratio: 0.5,
  y_ratio: 0.99,
  scale_boost: 1.0,
  angle_x: 12,
};

export async function ensureCubismCore(): Promise<void> {
  if (typeof window !== "undefined" && (window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-cubism-core="1"]') as HTMLScriptElement | null;
    if (existing) {
      if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Cubism Core 加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    script.src = `${base}live2dcubismcore.min.js`;
    script.async = false;
    script.dataset.cubismCore = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Cubism Core 加载失败"));
    document.head.appendChild(script);
  });
  if (!(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    throw new Error("Cubism Core 未就绪");
  }
}

function resolveEmotionKey(avatar: AvatarState | null): string {
  if (!avatar) return "neutral";
  return avatar.emotion || avatar.expression || "neutral";
}

const MOTION_ALIAS: Record<string, Live2dEmotionMapEntry> = {
  cross_arms: { motion_group: "TapBody", motion_index: 1 },
  point: { motion_group: "TapBody", motion_index: 2 },
  dismiss: { motion_group: "TapBody", motion_index: 2 },
  facepalm: { motion_group: "TapBody", motion_index: 2 },
  wave: { motion_group: "TapBody", motion_index: 0 },
  smug: { motion_group: "TapBody", motion_index: 0 },
  think: { motion_group: "Idle", motion_index: 0 },
};

function tapGroup(catalog?: Live2dModelInfo): string {
  return catalog?.tap_motion_group ?? "TapBody";
}

function pickEntry(catalog: Live2dModelInfo | undefined, avatar: AvatarState | null): Live2dEmotionMapEntry {
  const key = resolveEmotionKey(avatar);
  const map = catalog?.emotion_map ?? {};
  const body = tapGroup(catalog);
  if (map[key]) return map[key];
  if (avatar?.motion && map[avatar.motion]) return map[avatar.motion];
  if (avatar?.motion && MOTION_ALIAS[avatar.motion]) {
    return { ...MOTION_ALIAS[avatar.motion], motion_group: body };
  }
  return map.neutral ?? { motion_group: "Idle", motion_index: 0 };
}

function mergeLayout(layout?: Live2dLayout): Required<Live2dLayout> {
  return { ...DEFAULT_LAYOUT, ...layout };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLive2dAlive(model: any): boolean {
  return Boolean(model?.internalModel && !model.internalModel.destroyed && model.internalModel.coreModel);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeSetParam(core: any, paramId: string | undefined, value: number) {
  if (!paramId || !core?.getParameterIndex || !core?.setParameterValueByIndex) return;
  const idx = core.getParameterIndex(paramId);
  if (idx < 0 || idx >= core.getParameterCount()) return;
  core.setParameterValueByIndex(idx, value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function modelCanvasSize(model: any): { w: number; h: number } {
  const im = model?.internalModel;
  const w = im?.width || im?.originalWidth || model?.width || 400;
  const h = im?.height || im?.originalHeight || model?.height || 600;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** 将模型底部居中、放大并面向用户 */
export function fitLive2dModel(
  model: unknown,
  width: number,
  height: number,
  layout?: Live2dLayout,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = model as any;
  if (!isLive2dAlive(m) || width <= 0 || height <= 0) return;

  const cfg = mergeLayout(layout);
  const { w: mw, h: mh } = modelCanvasSize(m);

  m.rotation = 0;
  m.skew?.set?.(0, 0);
  m.anchor.set(cfg.anchor_x, cfg.anchor_y);

  const scale =
    Math.min((width * cfg.fill_width) / mw, (height * cfg.fill_height) / mh) * cfg.scale_boost;
  const abs = Math.abs(scale);
  m.scale.set(cfg.flip_x ? -abs : abs, abs);
  m.x = width * cfg.x_ratio;
  m.y = height * cfg.y_ratio;

  applyLive2dFacing(m, cfg);
}

/** 用模型原生参数 ID 微调朝向（须先校验 index，避免 Cubism assert 刷屏） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLive2dFacing(model: any, layout?: Live2dLayout) {
  if (!isLive2dAlive(model)) return;

  const cfg = mergeLayout(layout);
  const im = model.internalModel;
  const core = im.coreModel;
  const turn = cfg.flip_x ? cfg.angle_x : Math.max(0, cfg.angle_x - 10);

  safeSetParam(core, im.idParamAngleX, turn);
  safeSetParam(core, im.idParamBodyAngleX, turn * 0.18);
  safeSetParam(core, im.idParamEyeBallX, cfg.flip_x ? 0.22 : 0);
}

/** 仅更新表情与动作（低频） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLive2dExpression(model: any, catalog: Live2dModelInfo | undefined, avatar: AvatarState | null) {
  if (!isLive2dAlive(model)) return;

  const entry = pickEntry(catalog, avatar);
  const expr = entry.expression ?? catalog?.expressions?.[resolveEmotionKey(avatar)];

  try {
    if (expr) model.expression(expr);
  } catch {
    /* 部分模型无 expression */
  }

  const motionKey = `${entry.motion_group ?? "Idle"}:${entry.motion_index ?? 0}`;
  if (model.__companionMotionKey !== motionKey) {
    model.__companionMotionKey = motionKey;
    try {
      model.motion(entry.motion_group ?? "Idle", entry.motion_index ?? 0, 2);
    } catch {
      try {
        model.motion("Idle", 0, 1);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 仅更新口型（高频，TTS 时调用） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLive2dMouth(model: any, speaking: boolean, mouthLevel: number) {
  if (!isLive2dAlive(model)) return;

  const core = model.internalModel.coreModel;
  const mouth = speaking ? Math.min(1, Math.max(0, mouthLevel || 0.5)) : 0;
  safeSetParam(core, "ParamMouthOpenY", mouth);
  safeSetParam(core, model.internalModel.idParamMouthForm, speaking ? 0.3 : 0);
}

/** @deprecated 兼容旧调用 */
export function applyLive2dAvatar(
  model: unknown,
  catalog: Live2dModelInfo | undefined,
  avatar: AvatarState | null,
  speaking: boolean,
  mouthLevel: number,
) {
  applyLive2dExpression(model, catalog, avatar);
  applyLive2dMouth(model, speaking, mouthLevel);
}
