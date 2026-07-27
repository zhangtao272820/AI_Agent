/** RAG 查询意图 Playbook：口语 paraphrase → intent hint，供意图 RAG 预召回（仅通用句式，无领域样例） */
export type RagIntentPlaybookEntry = {
  id: string;
  paraphrases: string[];
  intent: string;
  retrieval_keywords: string[];
};

export const RAG_INTENT_PLAYBOOK: RagIntentPlaybookEntry[] = [
  {
    id: "fact_multi_field",
    paraphrases: [
      "A和B分别是多少",
      "两个指标分别是多少",
      "分别是什么",
      "各是多少",
    ],
    intent: "multi_part",
    retrieval_keywords: ["分别", "是多少", "多少"],
  },
  {
    id: "comparison",
    paraphrases: ["对比", "区别", "哪个更", "差异是什么"],
    intent: "comparison",
    retrieval_keywords: ["对比", "区别", "差异"],
  },
  {
    id: "definition",
    paraphrases: ["什么是", "定义", "含义是什么", "指的是什么"],
    intent: "definition",
    retrieval_keywords: ["定义", "含义", "概念"],
  },
  {
    id: "process",
    paraphrases: ["如何办理", "流程是什么", "步骤", "怎么申请"],
    intent: "process",
    retrieval_keywords: ["流程", "步骤", "办理"],
  },
  {
    id: "quote",
    paraphrases: ["原文", "摘录", "引用", "逐字"],
    intent: "quote",
    retrieval_keywords: ["原文", "摘录"],
  },
  {
    id: "completeness",
    paraphrases: ["全部列出", "所有条目", "穷尽", "有哪些全部"],
    intent: "fact_lookup",
    retrieval_keywords: ["全部", "所有", "列出"],
  },
  {
    id: "abstract_lookup",
    paraphrases: ["情况怎么样", "相关信息", "有哪些内容", "帮我查一下"],
    intent: "fact_lookup",
    retrieval_keywords: ["情况", "内容", "信息"],
  },
];
