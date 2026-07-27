import { useEffect, useState } from "react";
import type { BondSummary, QuestState, WorldPublic } from "../types";
import { affinityImpression, stageImpression } from "../impression";
import FaceChip from "./FaceChip";
import HeartTrack from "./HeartTrack";
import SpritePortrait from "./SpritePortrait";
import { menuSpriteUrl } from "../spriteUrl";

type Props = {
  world: WorldPublic;
  onBack: () => void;
  /** 打开时聚焦某角色详情 */
  focusId?: string | null;
  /** 当前对话场的线索（仅聚焦角色时展示） */
  quest?: QuestState | null;
  onOpenQuest?: () => void;
};

function talkSoft(b: BondSummary): string {
  const n = b.message_count || b.turns || 0;
  if (n <= 0) return "尚未交谈";
  if (n < 4) return "刚说过几句";
  if (n < 12) return "聊过一阵子";
  if (n < 30) return "已经很熟了";
  return "话说得很深";
}

function BondDetail({
  bond,
  quest,
  onOpenQuest,
  onBackList,
}: {
  bond: BondSummary;
  quest?: QuestState | null;
  onOpenQuest?: () => void;
  onBackList: () => void;
}) {
  const met = bond.turns > 0 || bond.message_count > 0;
  return (
    <div className="gal-heroine-detail">
      <button type="button" className="btn-ghost gal-heroine-detail-back" onClick={onBackList}>
        ← 一览
      </button>
      <div className="gal-heroine-detail-stage">
        {met ? (
          <>
            <img
              className="gal-heroine-menu-art"
              src={menuSpriteUrl(bond.character_id, "portrait")}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (sib) sib.hidden = false;
              }}
            />
            <div hidden>
              <SpritePortrait
                characterId={bond.character_id}
                outfit={bond.sprite_outfit || ""}
                emotion="neutral"
                themeColor={bond.theme_color}
                size="detail"
              />
            </div>
          </>
        ) : (
          <div className="gal-heroine-detail-fog" aria-hidden>
            <FaceChip
              characterId={bond.character_id}
              name={bond.name}
              themeColor={bond.theme_color}
              size="lg"
            />
          </div>
        )}
        <div className="gal-heroine-detail-copy">
          <h3>{met ? bond.name : "？？？"}</h3>
          <p>{bond.social_role_to_pc || "陌生人"}</p>
          {met ? (
            <>
              <em>
                {affinityImpression(bond.affinity)} · {stageImpression(bond.stage_id, bond.stage_label)}
              </em>
              <HeartTrack
                stageId={bond.stage_id}
                stageLabel={bond.stage_label}
                affinity={bond.affinity}
              />
            </>
          ) : (
            <em className="muted">身份会慢慢揭开</em>
          )}
        </div>
      </div>
      {met && bond.role_hint ? <p className="gal-heroine-detail-hint">{bond.role_hint}</p> : null}
      {met && bond.status_hint ? (
        <p className="gal-heroine-detail-status">{bond.status_hint}</p>
      ) : null}
      {met ? <p className="gal-heroine-detail-talk">{talkSoft(bond)}</p> : null}
      {met && quest?.active_step ? (
        <button type="button" className="gal-heroine-quest-chip" onClick={onOpenQuest}>
          <span>线索</span>
          <strong>{quest.active_step.label}</strong>
          {quest.total_steps > 0 ? (
            <em>
              {quest.completed_count}/{quest.total_steps}
            </em>
          ) : null}
        </button>
      ) : null}
      {!met ? <p className="muted">尚未交谈——身份已写在名片上。</p> : null}
    </div>
  );
}

export default function HeroinePanel({ world, onBack, focusId, quest, onOpenQuest }: Props) {
  const bonds = Object.values(world.bonds || {});
  const groups: Record<string, BondSummary[]> = {
    romance: [],
    neutral: [],
    npc: [],
  };
  for (const b of bonds) {
    (groups[b.cast_kind] || groups.npc).push(b);
  }

  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const selected = selectedId ? world.bonds?.[selectedId] : null;

  return (
    <div className="gal-codex gal-heroine-panel">
      <header className="gal-gallery-head">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返回
        </button>
        <h2>人物</h2>
        <span className="muted">关系与印象</span>
      </header>

      {selected ? (
        <BondDetail
          bond={selected}
          quest={selectedId === focusId ? quest : null}
          onOpenQuest={onOpenQuest}
          onBackList={() => setSelectedId(null)}
        />
      ) : (
        (["romance", "neutral", "npc"] as const)
          .filter((kind) => kind !== "npc" || groups.npc.length > 0)
          .map((kind) => (
            <section key={kind} className="gal-codex-section">
              <h3>
                {kind === "romance" ? "可能靠近的人" : kind === "neutral" ? "羁绊中的人" : "路过的人们"}
              </h3>
              <div className="gal-codex-grid gal-heroine-grid">
                {groups[kind].map((b) => {
                  const met = b.turns > 0 || b.message_count > 0;
                  return (
                    <button
                      key={b.character_id}
                      type="button"
                      className={`gal-codex-card gal-heroine-card${met ? "" : " gal-codex-card--fog"}`}
                      onClick={() => setSelectedId(b.character_id)}
                    >
                      {met ? (
                        <SpritePortrait
                          characterId={b.character_id}
                          outfit={b.sprite_outfit || ""}
                          emotion="happy"
                          themeColor={b.theme_color}
                          size="card"
                          className="gal-heroine-card-sprite"
                        />
                      ) : (
                        <FaceChip
                          characterId={b.character_id}
                          name={b.name}
                          themeColor={b.theme_color}
                          size="md"
                          className="gal-heroine-card-face"
                        />
                      )}
                      <strong>{met ? b.name : "？？？"}</strong>
                      <span>{b.social_role_to_pc || "陌生人"}</span>
                      {met && (
                        <>
                          <em>
                            {affinityImpression(b.affinity)} ·{" "}
                            {stageImpression(b.stage_id, b.stage_label)}
                          </em>
                          <HeartTrack
                            stageId={b.stage_id}
                            stageLabel={b.stage_label}
                            affinity={b.affinity}
                            compact
                          />
                        </>
                      )}
                      {!met && <p className="muted">尚未交谈</p>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
      )}
    </div>
  );
}
