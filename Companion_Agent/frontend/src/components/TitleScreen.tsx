import { useEffect, useState } from "react";
import { menuSpriteUrl, spriteUrl as animeSpriteUrl } from "../spriteUrl";

type CarouselSlide = {
  character_id: string;
  outfit?: string;
  emotion?: string;
  menu_slot?: string;
};

type Props = {
  connected: boolean;
  worldSaveCount: number;
  hasAutoSave?: boolean;
  displayName: string;
  carousel?: CarouselSlide[];
  reducedMotion?: boolean;
  onContinue: () => void;
  onNewWorld: () => void;
  onLoadSaves: () => void;
  onGallery: () => void;
  onSprites: () => void;
  onSettings: () => void;
  onLogout: () => void;
};

const FALLBACK_CAROUSEL: CarouselSlide[] = [
  { character_id: "xiaoyou", menu_slot: "hero" },
  { character_id: "wanyu", menu_slot: "portrait" },
  { character_id: "linxi", menu_slot: "work" },
  { character_id: "aili", menu_slot: "smile" },
];

export default function TitleScreen({
  connected,
  worldSaveCount,
  hasAutoSave = false,
  displayName,
  carousel,
  reducedMotion,
  onContinue,
  onNewWorld,
  onLoadSaves,
  onGallery,
  onSprites,
  onSettings,
  onLogout,
}: Props) {
  const slides = carousel?.length ? carousel : FALLBACK_CAROUSEL;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reducedMotion || slides.length <= 1) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % slides.length), 8000);
    return () => window.clearInterval(t);
  }, [reducedMotion, slides.length]);

  const slide = slides[idx] || slides[0];
  const heroSrc = slide
    ? menuSpriteUrl(slide.character_id, slide.menu_slot || "portrait")
    : "";

  return (
    <div className="gal-title-screen">
      <div
        className="gal-title-bg"
        style={{
          backgroundImage: "url(/api/bgs/title.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="gal-title-bg-shade" />
      <div className="gal-title-particles" aria-hidden />
      <div className="gal-title-frame" />

      {slide && (
        <div className="gal-title-hero-sprite" key={`${slide.character_id}-${idx}`}>
          <img
            src={heroSrc}
            alt=""
            onError={(e) => {
              const el = e.currentTarget;
              if (el.dataset.fb === "1") {
                el.src = animeSpriteUrl(slide.character_id, {
                  emotion: slide.emotion || "neutral",
                  outfit: slide.outfit || "",
                });
                return;
              }
              el.dataset.fb = "1";
              el.src = menuSpriteUrl(slide.character_id, "portrait");
            }}
          />
        </div>
      )}

      <div className="gal-title-user">
        <span>{displayName || "旅人"}</span>
        <button type="button" className="gal-nav-btn" onClick={onSettings}>
          设置
        </button>
        <button type="button" className="gal-nav-btn" onClick={onLogout}>
          切换账号
        </button>
      </div>

      <div className="gal-title-content">
        <p className="gal-title-kicker">Virtual Town Life</p>
        <h1 className="gal-title-main">邂逅的少女</h1>
        <p className="gal-title-sub">
          普通职员 · 与妹妹同住的小镇日常
          <br />
          去见她，听她说话——时段、天气、地点，都会悄悄改变她。
        </p>
        <nav className="gal-title-menu">
          <button
            type="button"
            className="gal-action-btn gal-action-btn--primary"
            disabled={!connected || !hasAutoSave}
            onClick={onContinue}
          >
            继续故事
          </button>
          <button type="button" className="gal-action-btn" disabled={!connected} onClick={onNewWorld}>
            开始新的邂逅
          </button>
          <button
            type="button"
            className="gal-action-btn"
            disabled={!connected || worldSaveCount === 0}
            onClick={onLoadSaves}
          >
            读档{worldSaveCount > 0 ? ` · ${worldSaveCount}` : ""}
          </button>
          <button type="button" className="gal-action-btn gal-action-btn--ghost" disabled={!connected} onClick={onSprites}>
            立绘大全
          </button>
          <button type="button" className="gal-action-btn gal-action-btn--ghost" onClick={onGallery}>
            已窥见的结局
          </button>
          <button type="button" className="gal-action-btn gal-action-btn--ghost" onClick={onSettings}>
            系统设置
          </button>
        </nav>
        {!connected && <p className="gal-title-hint">正在连接服务器…</p>}
        {connected && !hasAutoSave && (
          <p className="gal-title-hint gal-title-hint--soft">尚无自动存档。从醒来那一刻开始吧。</p>
        )}
      </div>
    </div>
  );
}
