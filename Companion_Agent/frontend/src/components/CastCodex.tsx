import type { QuestState, WorldPublic } from "../types";
import HeroinePanel from "./HeroinePanel";

type Props = {
  world: WorldPublic;
  onBack: () => void;
  focusId?: string | null;
  quest?: QuestState | null;
  onOpenQuest?: () => void;
};

/** 人物图鉴入口 → 美德式角色一览 / 详情 */
export default function CastCodex(props: Props) {
  return <HeroinePanel {...props} />;
}
