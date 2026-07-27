import type { QueryPath } from "../query_metrics";

/** 失败因果标签（供学习与反思，不用于问句正则路由）。 */
export function inferCausalFailureTag(input: {
  path: QueryPath;
  data_domain?: string;
  tables?: string[];
  empty?: boolean;
  reason?: string;
}): string | null {
  if (!input.empty && input.reason !== "empty_or_weak_answer") return null;
  const tableCount = (input.tables ?? []).length;

  if (input.data_domain === "person_health" && input.path === "person_info") {
    return "wrong_path_person_info_for_health";
  }
  if (input.data_domain === "person_health" && tableCount < 2) {
    return "missing_related_table";
  }
  if (input.empty) return "empty_result";
  return null;
}
