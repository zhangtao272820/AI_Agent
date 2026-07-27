import type { QueryExecutionShape } from "../nlu/dbQueryExecutionShapeLlm";

const EXECUTION_SHAPES = new Set([
  "scalar_lookup",
  "distribution",
  "trend",
  "detail_rows",
  "comparison",
  "freeform_sql",
]);

export function parseExecutionShapeFromState(raw: string): QueryExecutionShape | null {
  try {
    const obj = JSON.parse(String(raw || "{}")) as { shape?: string };
    const s = String(obj?.shape ?? "").trim();
    return EXECUTION_SHAPES.has(s) ? (s as QueryExecutionShape) : null;
  } catch {
    return null;
  }
}
