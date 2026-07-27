import { useMemo, useState } from "react";

const STORAGE_KEY = "campus_coach_v1";

const STEPS = [
  {
    title: "校园地图",
    body: "点击地点进入场景。图钉上的 Q 版脸是在场同学，点头像可直达立绘焦点。",
  },
  {
    title: "班级看板",
    body: "随时打开看板：看座位关系、成绩与好感。邻座可直聊，远座靠纸条——座位系统不会丢。",
  },
  {
    title: "对话与立绘",
    body: "地点舞台是全身立绘；对话时名牌旁用 Q 版头像。可自由输入，也可点寒暄/一起学习等互动。",
  },
];

export function isCoachDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markCoachDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Only show on day 1 until dismissed. */
  dayIndex: number;
  open: boolean;
  onClose: () => void;
}

export function CoachOverlay({ dayIndex, open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const visible = open && dayIndex === 1 && !isCoachDone();
  const current = useMemo(() => STEPS[step] || STEPS[0], [step]);

  if (!visible) return null;

  function finish() {
    markCoachDone();
    onClose();
  }

  return (
    <div className="coach-overlay" role="dialog" aria-modal="true" aria-label="新手引导">
      <article className="coach-card">
        <p className="coach-step">
          引导 {step + 1}/{STEPS.length}
        </p>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="coach-actions">
          <button type="button" className="btn ghost" onClick={finish}>
            跳过
          </button>
          {step + 1 < STEPS.length ? (
            <button type="button" className="btn primary" onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={finish}>
              开始入学
            </button>
          )}
        </div>
      </article>
    </div>
  );
}
