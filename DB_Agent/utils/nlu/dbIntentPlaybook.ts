/**
 * DB 查询意图 Playbook：口语 paraphrase → intent hint，供意图 RAG 预召回。
 */
import type { DbQueryIntent } from "./dbQueryIntentLlm";

export type DbIntentPlaybookEntry = {
  id: string;
  paraphrases: string[];
  intent: DbQueryIntent;
  slot_hints: string[];
};

export const DB_INTENT_PLAYBOOK: DbIntentPlaybookEntry[] = [
  {
    id: "attribute_scalar",
    paraphrases: [
      "总分是多少",
      "名称是什么",
      "[关联对象]的名称是什么",
      "某人的年龄是多少",
      "月收入是多少",
    ],
    intent: "attribute_lookup",
    slot_hints: ["是多少", "叫什么", "名称"],
  },
  {
    id: "detail_list",
    paraphrases: [
      "测试记录",
      "明细列表",
      "有哪些记录",
      "档案条目",
      "选项内容分别是什么",
    ],
    intent: "detail_list",
    slot_hints: ["记录", "明细", "列表"],
  },
  {
    id: "distribution",
    paraphrases: ["按性别分布", "各类型占比", "分组统计", "性别分布", "年龄段性别分布"],
    intent: "distribution",
    slot_hints: ["分布", "占比", "分组"],
  },
  {
    id: "trend",
    paraphrases: ["变化趋势", "最近一个月", "走势如何"],
    intent: "trend",
    slot_hints: ["趋势", "变化", "最近"],
  },
  {
    id: "comparison",
    paraphrases: ["对比", "区别", "哪个更高"],
    intent: "comparison",
    slot_hints: ["对比", "区别"],
  },
  {
    id: "schema_help",
    paraphrases: ["有哪些字段", "表结构", "字段说明"],
    intent: "schema_help",
    slot_hints: ["字段", "表结构"],
  },
];
