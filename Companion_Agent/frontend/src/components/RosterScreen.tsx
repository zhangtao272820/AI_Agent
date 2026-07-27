import { useEffect, useMemo } from "react";
import type { CharacterBase, CharacterProfile, CharacterRoute } from "../types";
import { encounterFog, firstGlanceLine } from "../impression";
import SpriteAvatar from "./SpriteAvatar";

type Props = {
  profile: CharacterProfile;
  characterBases: CharacterBase[];
  routes: CharacterRoute[];
  selectedBaseId: string;
  selectedCharacterId: string;
  onSelectBase: (baseId: string) => void;
  onSelectCharacter: (characterId: string) => void;
  onChangeName: (name: string) => void;
  onStart: () => void;
  onBack: () => void;
  disabled?: boolean;
};

export default function RosterScreen({
  profile,
  characterBases,
  routes: _routes,
  selectedBaseId,
  selectedCharacterId,
  onSelectBase,
  onSelectCharacter,
  onChangeName,
  onStart,
  onBack,
  disabled,
}: Props) {
  const activeBase = characterBases.find((b) => b.id === selectedBaseId) ?? characterBases[0];
  const characters = activeBase?.characters ?? [];
  const activeCharacter = characters.find((c) => c.id === selectedCharacterId) ?? characters[0];
  const fog = encounterFog(activeBase?.id || selectedBaseId);
  const theme = activeBase?.theme_color || profile.theme_color || "#f472b6";
  const routeBg =
    selectedBaseId === "fantasy_spirit"
      ? "/api/bgs/forest.png"
      : selectedBaseId === "mature_sister" || selectedBaseId === "gentle_lover"
        ? "/api/bgs/cafe.png"
        : selectedBaseId === "sarcastic_lover"
          ? "/api/bgs/rain.png"
          : "/api/bgs/campus.png";

  const glance = useMemo(
    () =>
      firstGlanceLine({
        name: profile.name,
        occupation: profile.occupation,
        age: profile.age,
        relationship: activeCharacter?.profile.relationship || profile.relationship,
      }),
    [profile, activeCharacter],
  );

  useEffect(() => {
    if (!characters.some((c) => c.id === selectedCharacterId) && characters[0]) {
      onSelectCharacter(characters[0].id);
    }
  }, [characters, selectedCharacterId, onSelectCharacter]);

  return (
    <div className="gal-roster-root gal-roster-root--mystery">
      <div
        className="gal-roster-bg"
        style={{
          backgroundImage: `url(${routeBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div
        className="gal-roster-bg-shade"
        style={{
          background: `radial-gradient(ellipse 55% 50% at 28% 72%, ${theme}22, transparent 70%)`,
        }}
      />
      <div className="gal-roster-vignette" />

      <header className="gal-roster-head">
        <button type="button" className="gal-nav-btn" onClick={onBack}>
          ← 标题
        </button>
        <h1 className="gal-roster-title">选择邂逅</h1>
        <span className="gal-roster-count">命运藏在对话里</span>
      </header>

      <div className="gal-roster-layout">
        <section className="gal-roster-stage" aria-label="角色立绘">
          <SpriteAvatar
            characterId={profile.character_id || activeCharacter?.id || "qingcai"}
            avatar={{ emotion: "neutral", expression: "neutral", motion: "idle" }}
            themeColor={theme}
            style="photoreal"
            outfit=""
          />
          <div className="gal-roster-name-float" style={{ borderColor: theme }}>
            <span className="gal-roster-name">{profile.name}</span>
            <span className="gal-roster-tag">{fog.place}</span>
            <span className="gal-roster-cast">面纱之后的她</span>
          </div>
        </section>

        <section className="gal-roster-panel gal-roster-panel--mystery">
          <div className="gal-route-rail">
            <p className="gal-section-label">邂逅之地</p>
            <div className="gal-route-tabs">
              {characterBases.map((base) => {
                const baseFog = encounterFog(base.id);
                const selected = selectedBaseId === base.id;
                return (
                  <button
                    key={base.id}
                    type="button"
                    className={`gal-route-tab${selected ? " gal-route-tab--active" : ""}`}
                    style={selected ? { borderColor: base.theme_color, color: base.theme_color } : undefined}
                    disabled={disabled}
                    onClick={() => onSelectBase(base.id)}
                  >
                    <strong>{baseFog.title}</strong>
                    <span>{baseFog.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="gal-char-rail">
            <p className="gal-section-label">在这里遇见的人</p>
            <div className="gal-char-cards">
              {characters.map((character) => {
                const selected = selectedCharacterId === character.id;
                return (
                  <button
                    key={character.id}
                    type="button"
                    className={`gal-char-card gal-char-card--soft${selected ? " gal-char-card--active" : ""}`}
                    style={selected ? { borderColor: theme, boxShadow: `0 0 20px ${theme}33` } : undefined}
                    disabled={disabled}
                    onClick={() => onSelectCharacter(character.id)}
                  >
                    <img
                      className="gal-char-thumb"
                      src={`/api/sprites/${character.id}/neutral.png?v24unify`}
                      alt=""
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (!img.dataset.fb) {
                          img.dataset.fb = "1";
                          img.src = `/api/sprites/${character.id}/happy.png?v24unify`;
                        }
                      }}
                    />
                    <div className="gal-char-card-text">
                      <strong>{character.label}</strong>
                      <span>？？？</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="gal-roster-story gal-roster-story--mystery">
            <label className="gal-name-edit">
              <span>你如何称呼她</span>
              <input
                value={profile.name}
                disabled={disabled}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="名字会写进你们的故事"
              />
            </label>
            {profile.opening_line && (
              <blockquote className="gal-roster-opening">「……」她似乎说了什么，听不清。</blockquote>
            )}
            <p className="gal-roster-personality">{glance}</p>
            <p className="gal-roster-mystery-hint">
              性格、心意、结局分支不会提前揭晓。聊下去，你会慢慢看清她——以及你们的路。
            </p>
          </div>

          <button
            type="button"
            className="gal-action-btn gal-action-btn--primary gal-roster-start"
            disabled={disabled || characterBases.length === 0 || characters.length === 0}
            onClick={onStart}
          >
            走向她
          </button>
        </section>
      </div>
    </div>
  );
}
