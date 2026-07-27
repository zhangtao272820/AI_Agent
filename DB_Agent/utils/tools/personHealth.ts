/**
 * 个人健康记录查询工具。
 */
import type { DataSource } from "typeorm";
import { DB_AGENT_DEFAULTS } from "../db_agent_env";
import { getDomainTable } from "../domain_patch";
import {
  extractHealthMetricIdsStructural,
  resolveHealthMetricIds,
} from "../nlu/dbHealthMetricLlm";
import { wantsDetailRowsStructural } from "../nlu/dbSqlOutputShapeLlm";
import {
  getTableColumns,
  isIdKey,
  isSensitiveKey,
  normalizeValue,
  normalizeValueKeepEmpty,
  pickHealthLinkCandidates,
  pickHealthNameColumn,
  pickHealthTimeColumn,
  type TableColumnInfo,
} from "./shared";

function isDomainToolsEnabled() {
  return DB_AGENT_DEFAULTS.enableDomainSkills;
}

function pickHealthMetricColumns(cols: TableColumnInfo[], metricIds: string[]) {
  const specs: Record<
    string,
    { label: string; commentHints: RegExp[]; nameHints: RegExp[] }
  > = {
    height: { label: "身高", commentHints: [/身高|身长/], nameHints: [/height|stature/] },
    weight: { label: "体重", commentHints: [/体重/], nameHints: [/weight/] },
    heart_rate: { label: "心率", commentHints: [/心率|脉搏|心跳/], nameHints: [/heart.*rate|heartrate|\bhr\b|pulse/] },
    spo2: { label: "血氧饱和度", commentHints: [/血氧|饱和度/], nameHints: [/spo2|oxygen/] },
    temperature: { label: "体温", commentHints: [/体温|温度/], nameHints: [/temp|temperature/] },
    sbp: { label: "收缩压", commentHints: [/收缩压|高压/], nameHints: [/sbp|systolic|sys/] },
    dbp: { label: "舒张压", commentHints: [/舒张压|低压/], nameHints: [/dbp|diastolic|dia/] },
    glucose: { label: "血糖", commentHints: [/血糖/], nameHints: [/glucose|blood_sugar|sugar/] },
    bmi: { label: "BMI 指数", commentHints: [/bmi|体质指数/], nameHints: [/bmi/] },
    bmr: { label: "基础代谢率", commentHints: [/基础代谢/], nameHints: [/bmr|basal.*metabolic/] },
    uric_acid: { label: "尿酸", commentHints: [/尿酸/], nameHints: [/uric/] },
    chol: { label: "总胆固醇", commentHints: [/总胆固醇/], nameHints: [/chol(?!e?s?t?e?r?o?l.*(hdl|ldl))/] },
    hdl: { label: "高密度脂蛋白", commentHints: [/高密度脂蛋白/], nameHints: [/hdl/] },
    ldl: { label: "低密度脂蛋白", commentHints: [/低密度脂蛋白/], nameHints: [/ldl/] },
    tg: { label: "甘油三酯", commentHints: [/甘油三酯|三酰甘油/], nameHints: [/triglyceride|\btg\b/] },
    left_vision: { label: "左眼视力", commentHints: [/左眼视力/], nameHints: [/left.*vision|vision.*left|l_vision/] },
    right_vision: { label: "右眼视力", commentHints: [/右眼视力/], nameHints: [/right.*vision|vision.*right|r_vision/] },
    left_hearing: { label: "左耳听力", commentHints: [/左耳听力/], nameHints: [/left.*hear|hearing.*left|l_hear/] },
    right_hearing: { label: "右耳听力", commentHints: [/右耳听力/], nameHints: [/right.*hear|hearing.*right|r_hear/] },
    muscle_rate: { label: "肌肉率", commentHints: [/肌肉率/], nameHints: [/muscle/] },
    fat_rate: { label: "体脂率", commentHints: [/体脂率/], nameHints: [/fat.*rate|bodyfat/] },
    visceral_fat: { label: "内脏脂肪率", commentHints: [/内脏脂肪/], nameHints: [/visceral/] },
    waist: { label: "腰围", commentHints: [/腰围/], nameHints: [/waist/] },
    hip: { label: "臀围", commentHints: [/臀围|髋围/], nameHints: [/hip/] },
    water_rate: { label: "水分率", commentHints: [/水分率|水分/], nameHints: [/water/] },
    bone_mass: { label: "骨量", commentHints: [/骨量/], nameHints: [/bone/] },
  };

  const wanted: string[] = [];
  const labels: string[] = [];
  const inputIds = Array.from(new Set(metricIds));
  for (const id of inputIds) {
    const spec = specs[id];
    if (!spec) continue;
    labels.push(spec.label);
    for (const c of cols) {
      const name = String(c?.name ?? "");
      const comment = String(c?.comment ?? "");
      const nlc = name.toLowerCase();
      if (spec.commentHints.some((re) => re.test(comment)) || spec.nameHints.some((re) => re.test(nlc))) {
        wanted.push(name);
      }
    }
  }
  return { columns: Array.from(new Set(wanted)).filter(Boolean), label: Array.from(new Set(labels)).join("、") };
}

export async function queryPersonHealthRecordsTool(
  ds: DataSource,
  params: { personId: string; personName: string; question: string; limit?: number; nluModel?: import("@langchain/openai").ChatOpenAI | null },
) {
  const personId = String(params.personId ?? "").trim();
  const personName = String(params.personName ?? "").trim();
  const q = String(params.question ?? "").trim();
  const limit = Math.max(1, Math.min(10, Number(params.limit ?? 5)));
  if (!personId) return null;

  const table = getDomainTable("person_health_records", "person_health_records");
  const cols = await getTableColumns(ds, table);
  if (!cols.length) return null;

  const linkCandidates = pickHealthLinkCandidates(cols);
  const timeCol = pickHealthTimeColumn(cols);
  const nameCol = pickHealthNameColumn(cols);
  const available = new Set(cols.map((c) => String(c.name || "")));
  const safeCol = (n: string | null) => (n && available.has(n) ? n : null);
  const safeTime = safeCol(timeCol);
  const metricIds = isDomainToolsEnabled()
    ? await resolveHealthMetricIds(params.nluModel ?? null, q)
    : extractHealthMetricIdsStructural(q);
  const wantsList = wantsDetailRowsStructural(q);
  const effectiveLimit = metricIds.length > 0 && !wantsList ? 1 : limit;

  const normalizeValueKeepEmpty = (v: any) => {
    if (v === null || v === undefined) return "（空）";
    if (typeof v === "string") return v.trim() ? v.trim() : "（空）";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try {
      const j = JSON.stringify(v);
      return j && j !== "null" ? j : "（空）";
    } catch {
      const s = String(v);
      return s.trim() ? s.trim() : "（空）";
    }
  };

  const renderRows = (rows: any[], excludeCol: string) => {
    const commentByName: Record<string, string> = {};
    for (const cc of cols) if (cc?.name) commentByName[String(cc.name)] = String(cc.comment ?? "");

    if (metricIds.length > 0) {
      const picked = pickHealthMetricColumns(cols, metricIds);
      const wantedCols = picked.columns
        .filter((k) => k && !isIdKey(k) && !isSensitiveKey(k) && k !== excludeCol)
        .slice(0, 10);
      if (wantedCols.length > 0) {
        const title = `${personName} 的${picked.label || "健康指标"}如下（最近 ${Math.min(effectiveLimit, rows.length)} 条）：`;
        const out: string[] = [title, ""];
        const timeLabel = safeTime ? String(commentByName[safeTime] || safeTime) : "";
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] ?? {};
          out.push(`记录 ${i + 1}：`);
          if (safeTime) out.push(`- ${timeLabel}：${normalizeValueKeepEmpty((r as any)[safeTime])}`);
          for (const k of wantedCols) {
            const label = String(commentByName[k] || k);
            out.push(`- ${label}：${normalizeValueKeepEmpty((r as any)[k])}`);
          }
          out.push("");
        }
        return out.join("\n").trim();
      }
    }

    const lines: string[] = [`${personName} 的个人健康信息如下（最近 ${Math.min(effectiveLimit, rows.length)} 条）：`, ""];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const showKeys = Object.keys(r).filter((k) => !isIdKey(k) && !isSensitiveKey(k) && String(k) !== excludeCol);
      lines.push(`记录 ${i + 1}：`);
      let printed = 0;
      for (const k of showKeys) {
        const val = normalizeValue((r as any)[k]);
        if (!val) continue;
        const label = String(commentByName[k] || k);
        lines.push(`- ${label}：${val}`);
        printed += 1;
        if (printed >= 18) break;
      }
      if (printed === 0) lines.push("- 暂无可展示的健康指标字段");
      lines.push("");
    }
    return lines.join("\n").trim();
  };

  const tryById = async (col: string) => {
    if (!available.has(col)) return { ok: false as const, col };
    const countRows = await ds.query(`SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${col}\` = ? LIMIT 1`, [personId]);
    const c = Array.isArray(countRows) && countRows[0] ? Number((countRows[0] as any).c) : 0;
    if (!Number.isFinite(c) || c <= 0) return { ok: false as const, col };
    const sql = `SELECT * FROM \`${table}\` WHERE \`${col}\` = ?${safeTime ? ` ORDER BY \`${safeTime}\` DESC` : ""} LIMIT ${effectiveLimit}`;
    const rows = await ds.query(sql, [personId]);
    return { ok: Array.isArray(rows) && rows.length > 0, col, rows: Array.isArray(rows) ? rows : [] };
  };

  for (const c of linkCandidates) {
    try {
      const hit = await tryById(c);
      if (hit.ok) {
        return renderRows(hit.rows || [], hit.col);
      }
    } catch {}
  }

  const safeNameCol = safeCol(nameCol);
  if (safeNameCol && personName) {
    try {
      const countRows = await ds.query(`SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${safeNameCol}\` = ? LIMIT 1`, [personName]);
      const c = Array.isArray(countRows) && countRows[0] ? Number((countRows[0] as any).c) : 0;
      if (Number.isFinite(c) && c > 0) {
        const sql = `SELECT * FROM \`${table}\` WHERE \`${safeNameCol}\` = ?${safeTime ? ` ORDER BY \`${safeTime}\` DESC` : ""} LIMIT ${effectiveLimit}`;
        const rows = await ds.query(sql, [personName]);
        if (Array.isArray(rows) && rows.length > 0) {
          return renderRows(rows, safeNameCol);
        }
      }
    } catch {}
  }

  const extra =
    linkCandidates.length > 0
      ? "已用人员信息定位到该老人，并尝试按健康记录里的人员关联字段匹配，但没有找到记录。"
      : "健康记录表里未找到可识别的人员关联字段（例如 person_id）。";
  return `${personName} 暂未找到个人健康记录。\n${extra}\n你也可以确认一下该老人是否已经录入过健康信息。`.trim();
}
