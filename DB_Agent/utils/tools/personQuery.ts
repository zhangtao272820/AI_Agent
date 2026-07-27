/**
 * 人员档案查询：姓名解析、候选检索、消歧与字段回答。
 */
import type { DataSource } from "typeorm";
import { getDomainTable } from "../domain_patch";
import { maskPhone, extractPersonName } from "./maskPhone";

type PersonQueryFilters = {
  id?: string;
  gender?: 1 | 2;
  ageEq?: number;
  ageGte?: number;
  ageLte?: number;
  regionLike?: string;
};

function parsePersonFilters(question: string): PersonQueryFilters {
  /** 过滤条件由 QueryPlan / dbEntityLlm 提供；同步路径仅保留显式 id= 技术格式 */
  const q = String(question ?? "").replace(/\s+/g, "");
  const filters: PersonQueryFilters = {};
  const idMatch = q.match(/(?:^|[^a-z0-9])(id|person_id|编号)\s*[:=]?\s*(\d{1,20})/i);
  if (idMatch?.[2]) filters.id = String(idMatch[2]);
  return filters;
}

function toGenderText(v: unknown) {
  return v === 1 || v === "1" ? "男" : v === 2 || v === "2" ? "女" : "未知";
}

async function queryPersonCandidates(
  ds: DataSource,
  params: { name?: string; filters?: PersonQueryFilters; limit?: number },
) {
  const name = String(params.name ?? "").trim();
  const filters = params.filters ?? {};
  const limit = Math.max(1, Math.min(50, Number(params.limit ?? 10)));

  const where: string[] = [];
  const values: any[] = [];

  if (filters.id) {
    where.push("pi.id = ?");
    values.push(filters.id);
  } else if (name) {
    where.push("(pi.name = ? OR pi.name LIKE ?)");
    values.push(name, `%${name}%`);
  } else {
    return [];
  }

  if (filters.gender) {
    where.push("pi.is_gender = ?");
    values.push(filters.gender);
  }
  if (typeof filters.ageEq === "number" && Number.isFinite(filters.ageEq)) {
    where.push("pi.age = ?");
    values.push(filters.ageEq);
  } else {
    if (typeof filters.ageGte === "number" && Number.isFinite(filters.ageGte)) {
      where.push("pi.age >= ?");
      values.push(filters.ageGte);
    }
    if (typeof filters.ageLte === "number" && Number.isFinite(filters.ageLte)) {
      where.push("pi.age <= ?");
      values.push(filters.ageLte);
    }
  }
  if (filters.regionLike) {
    where.push("(pi.provinces_and_cities LIKE ? OR pi.address LIKE ?)");
    values.push(`%${filters.regionLike}%`, `%${filters.regionLike}%`);
  }

  const tPerson = getDomainTable("person_info", "person_info");
  const tCrowd = getDomainTable("person_crowd_type", "person_crowd_type");
  const tSelfcare = getDomainTable("person_selfcare_conditions", "person_selfcare_conditions");
  const tLive = getDomainTable("person_live_conditions", "person_live_conditions");
  const tLife = getDomainTable("person_life_conditions", "person_life_conditions");
  const sql = `
SELECT
  pi.id,
  pi.name,
  pi.is_gender,
  pi.age,
  pi.provinces_and_cities,
  pi.address,
  pi.remark,
  pct.name AS crowd_type_name,
  psc.name AS selfcare_conditions_name,
  plc.name AS live_conditions_name,
  plfc.name AS life_conditions_name
FROM ${tPerson} pi
LEFT JOIN ${tCrowd} pct ON pi.crowd_type_id = pct.id
LEFT JOIN ${tSelfcare} psc ON pi.selfcare_conditions_id = psc.id
LEFT JOIN ${tLive} plc ON pi.live_conditions_id = plc.id
LEFT JOIN ${tLife} plfc ON pi.life_conditions_id = plfc.id
WHERE ${where.join(" AND ")}
ORDER BY
  CASE WHEN pi.name = ? THEN 0 ELSE 1 END,
  pi.name,
  pi.id
LIMIT ${limit}
  `;
  return await ds.query(sql, [...values, name]);
}

function renderPersonDisambiguation(params: {
  name: string;
  rows: any[];
  reason: "duplicate_name" | "multi_match";
  attr?: string | null;
}) {
  const name = params.name;
  const rows = params.rows || [];
  const attrLabel =
    params.attr === "age"
      ? "年龄"
      : params.attr === "gender"
        ? "性别"
        : params.attr === "address"
          ? "地址"
          : params.attr === "contacts"
            ? "联系方式"
            : params.attr === "crowd"
              ? "人群分类"
              : params.attr === "selfcare"
                ? "自理情况"
                : params.attr === "live"
                  ? "居住情况"
                  : params.attr === "life"
                    ? "生活情况"
                    : params.attr;
  const title =
    params.reason === "duplicate_name"
      ? `检测到“${name}”存在重名（共 ${rows.length} 条）。`
      : `找到了多个与“${name}”相关的人员（共 ${rows.length} 条）。`;
  const lines: string[] = [title, "为避免查错人，请补充一个条件后我再返回对应结果：", ""];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as any;
    const gender = toGenderText(r?.is_gender);
    const age = typeof r?.age === "number" || typeof r?.age === "string" ? String(r.age) : "";
    const addr = [r?.provinces_and_cities, r?.address].filter(Boolean).join(" ");
    const crowd = r?.crowd_type_name ?? "";
    const parts = [gender];
    if (age) parts.push(`${age}岁`);
    if (crowd) parts.push(`人群:${crowd}`);
    if (addr) parts.push(`地址:${addr}`);
    lines.push(`${i + 1}) ${r?.name ?? name}（${parts.filter(Boolean).join("，")}）`);
  }
  lines.push("");
  if (attrLabel) lines.push(`你想查的是“${attrLabel}”，需要先定位到具体哪一位。`);
  lines.push("你可以这样补充：");
  lines.push(`- ${name} 天津市河西区`);
  lines.push(`- ${name} 80岁以上 / ${name} 女`);
  return lines.join("\n");
}

export async function queryPersonFullInfoTool(ds: DataSource, input: string) {
  const filters = parsePersonFilters(input);
  const rawName = extractPersonName(input) ?? input.trim();
  const name = String(rawName ?? "").trim();
  if (!name) return null;

  const rows = await queryPersonCandidates(ds, { name, filters, limit: 10 });

  if (!Array.isArray(rows) || rows.length === 0) return null;

  const exactMatches = rows.filter((r: any) => String(r?.name ?? "").trim() === name);
  if (rows.length > 1) {
    const reason = exactMatches.length >= 2 ? "duplicate_name" : "multi_match";
    return renderPersonDisambiguation({ name, rows, reason });
  }

  const person = rows[0] as any;
  const tContact = getDomainTable("person_emergency_contact", "person_emergency_contact");
  const contacts = await ds.query(
    `
SELECT
  concat_name_first,
  concat_phone_first,
  concat_name_second,
  concat_phone_second
FROM ${tContact}
WHERE person_id = ?
LIMIT 1
    `,
    [person.id]
  );

  const c = Array.isArray(contacts) && contacts.length > 0 ? (contacts[0] as any) : null;
  const gender = toGenderText(person.is_gender);

  const lines = [
    `${person.name} 老人信息如下：`,
    `- 姓名：${person.name}`,
    `- 性别：${gender}`,
    `- 年龄：${person.age ?? ""}`,
    `- 人群分类：${person.crowd_type_name ?? ""}`,
    `- 自理情况：${person.selfcare_conditions_name ?? ""}`,
    `- 居住情况：${person.live_conditions_name ?? ""}`,
    `- 生活情况：${person.life_conditions_name ?? ""}`,
    `- 地址：${[person.provinces_and_cities, person.address].filter(Boolean).join(" ")}`,
  ];

  if (person.remark) lines.push(`- 备注：${person.remark}`);

  if (c) {
    const items = [
      c.concat_name_first
        ? `${c.concat_name_first}${c.concat_phone_first ? `（${maskPhone(c.concat_phone_first)}）` : ""}`
        : "",
      c.concat_name_second
        ? `${c.concat_name_second}${c.concat_phone_second ? `（${maskPhone(c.concat_phone_second)}）` : ""}`
        : "",
    ].filter(Boolean);
    if (items.length > 0) lines.push(`- 紧急联系人：${items.join("；")}`);
  }

  return lines.join("\n");
}

export async function answerPersonQuery(
  ds: DataSource,
  question: string,
  opts?: { attr?: string | null; name?: string | null },
) {
  const filters = parsePersonFilters(question);
  const name = String((opts?.name ?? extractPersonName(question)) ?? "").trim();
  if (!name) return null;
  const rows = await queryPersonCandidates(ds, { name, filters, limit: 10 });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const attr = (opts?.attr ?? extractPersonAttribute(question));
  const exactMatches = rows.filter((r: any) => String(r?.name ?? "").trim() === name);
  if (rows.length > 1) {
    const reason = exactMatches.length >= 2 ? "duplicate_name" : "multi_match";
    return renderPersonDisambiguation({ name, rows, reason, attr });
  }

  const person = rows[0] as any;
  const gender = toGenderText(person.is_gender);
  if (!attr) return await queryPersonFullInfoTool(ds, `id=${person.id}`);
  if (attr === "age") return `${person.name}的年龄：${person.age ?? ""}`.trim();
  if (attr === "gender") return `${person.name}的性别：${gender}`;
  if (attr === "address") {
    const addr = [person.provinces_and_cities, person.address].filter(Boolean).join(" ");
    return `${person.name}的地址：${addr}`.trim();
  }
  if (attr === "crowd") return `${person.name}的人群分类：${person.crowd_type_name ?? ""}`.trim();
  if (attr === "selfcare") return `${person.name}的自理情况：${person.selfcare_conditions_name ?? ""}`.trim();
  if (attr === "live") return `${person.name}的居住情况：${person.live_conditions_name ?? ""}`.trim();
  if (attr === "life") return `${person.name}的生活情况：${person.life_conditions_name ?? ""}`.trim();
  if (attr === "contacts") {
    const contacts = await ds.query(
      `
SELECT
  concat_name_first,
  concat_phone_first,
  concat_name_second,
  concat_phone_second
FROM person_emergency_contact
WHERE person_id = ?
LIMIT 1
      `,
      [person.id],
    );
    const c = Array.isArray(contacts) && contacts.length > 0 ? (contacts[0] as any) : null;
    if (!c) return `${person.name}的联系方式：暂无`;
    const items = [
      c.concat_name_first
        ? `${c.concat_name_first}${c.concat_phone_first ? `（${maskPhone(c.concat_phone_first)}）` : ""}`
        : "",
      c.concat_name_second
        ? `${c.concat_name_second}${c.concat_phone_second ? `（${maskPhone(c.concat_phone_second)}）` : ""}`
        : "",
    ].filter(Boolean);
    return `${person.name}的联系方式：${items.join("；") || "暂无"}`;
  }
  return await queryPersonFullInfoTool(ds, `id=${person.id}`);
}

export async function resolvePersonId(ds: DataSource, question: string, opts?: { name?: string | null }) {
  const filters = parsePersonFilters(question);
  const name = String((opts?.name ?? extractPersonName(question)) ?? "").trim();
  if (!name) return { kind: "missing_name" as const };
  const rows = await queryPersonCandidates(ds, { name, filters, limit: 10 });
  if (!Array.isArray(rows) || rows.length === 0) return { kind: "not_found" as const, name };
  const exactMatches = rows.filter((r: any) => String(r?.name ?? "").trim() === name);
  if (rows.length > 1) {
    const reason = exactMatches.length >= 2 ? "duplicate_name" : "multi_match";
    return { kind: "disambiguation" as const, name, text: renderPersonDisambiguation({ name, rows, reason }) };
  }
  const person = rows[0] as any;
  const personId = String(person?.id ?? "").trim();
  if (!personId) return { kind: "not_found" as const, name };
  return { kind: "resolved" as const, name: String(person?.name ?? name).trim() || name, personId };
}
