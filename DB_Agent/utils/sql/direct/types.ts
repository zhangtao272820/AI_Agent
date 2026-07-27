export type SqlDirectResult =
  | { ok: true; answer: string; sql: string; rowCount: number; explain_insights?: string[] }
  | { ok: false; reason: string };