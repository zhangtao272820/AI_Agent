/**
 * P7 企业 IdP：OIDC Bearer JWT 解析与校验（HS256 / 网关透传 payload）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getRagAgentEnv } from "./rag_agent_env";
import { sanitizeUserId } from "./agent_identity";

type JwtPayload = {
  sub?: string;
  preferred_username?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  roles?: string[];
  realm_access?: { roles?: string[] };
};

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

function parseJwt(token: string): { header: Record<string, unknown>; payload: JwtPayload } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]!)) as Record<string, unknown>;
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as JwtPayload;
    return { header, payload };
  } catch {
    return null;
  }
}

function verifyHs256(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const data = `${parts[0]}.${parts[1]}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  const expected = Buffer.from(sig);
  const actual = Buffer.from(parts[2]!.replace(/=/g, ""));
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function audienceMatches(aud: JwtPayload["aud"], expected: string): boolean {
  if (!expected) return true;
  if (!aud) return false;
  if (Array.isArray(aud)) return aud.includes(expected);
  return String(aud) === expected;
}

function extractRoles(payload: JwtPayload): string[] {
  const direct = Array.isArray(payload.roles) ? payload.roles : [];
  const realm = Array.isArray(payload.realm_access?.roles) ? payload.realm_access!.roles! : [];
  return [...new Set([...direct, ...realm].map((r) => String(r).trim()).filter(Boolean))];
}

export function getOidcPublicConfig() {
  const env = getRagAgentEnv();
  return {
    enabled: env.enableOidc,
    issuer: env.oidcIssuer || null,
    audience: env.oidcAudience || null,
    userinfoUrl: env.oidcUserinfoUrl || null,
    header: "Authorization: Bearer <access_token>",
    claimPriority: ["sub", "preferred_username"],
  };
}

/** 从 Authorization Bearer 解析 userId；失败返回 null */
export function resolveOidcUserId(authorizationHeader?: string): {
  userId: string | null;
  roles: string[];
  reason?: string;
} {
  const env = getRagAgentEnv();
  if (!env.enableOidc) return { userId: null, roles: [] };

  const raw = String(authorizationHeader ?? "").trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return { userId: null, roles: [], reason: "no_bearer" };

  const token = m[1].trim();
  const parsed = parseJwt(token);
  if (!parsed) return { userId: null, roles: [], reason: "invalid_jwt" };

  const secret = String(process.env.RAG_OIDC_JWT_SECRET ?? "").trim();
  if (secret) {
    const alg = String(parsed.header.alg ?? "");
    if (alg !== "HS256" || !verifyHs256(token, secret)) {
      return { userId: null, roles: [], reason: "jwt_verify_failed" };
    }
  } else if (!env.oidcTrustGateway) {
    return { userId: null, roles: [], reason: "jwt_secret_required" };
  }

  const { payload } = parsed;
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return { userId: null, roles: [], reason: "token_expired" };
  }
  if (env.oidcIssuer && payload.iss && payload.iss !== env.oidcIssuer) {
    return { userId: null, roles: [], reason: "issuer_mismatch" };
  }
  if (env.oidcAudience && !audienceMatches(payload.aud, env.oidcAudience)) {
    return { userId: null, roles: [], reason: "audience_mismatch" };
  }

  const candidate =
    sanitizeUserId(payload.sub) ||
    sanitizeUserId(payload.preferred_username) ||
    sanitizeUserId(String(payload.email ?? "").split("@")[0]);

  if (!candidate) return { userId: null, roles: [], reason: "no_subject" };

  return { userId: candidate, roles: extractRoles(payload) };
}

/** Userinfo 回退（部分 IdP 仅发 opaque token） */
export async function resolveOidcUserFromUserinfo(authorizationHeader?: string): Promise<string | null> {
  const env = getRagAgentEnv();
  const url = String(env.oidcUserinfoUrl ?? "").trim();
  if (!env.enableOidc || !url) return null;

  const raw = String(authorizationHeader ?? "").trim();
  if (!/^Bearer\s+/i.test(raw)) return null;

  try {
    const res = await fetch(url, { headers: { Authorization: raw } });
    if (!res.ok) return null;
    const data = (await res.json()) as JwtPayload;
    return (
      sanitizeUserId(data.sub) ||
      sanitizeUserId(data.preferred_username) ||
      null
    );
  } catch {
    return null;
  }
}

export async function resolveOidcIdentity(authorizationHeader?: string) {
  const jwt = resolveOidcUserId(authorizationHeader);
  if (jwt.userId) return jwt;
  const fromUserinfo = await resolveOidcUserFromUserinfo(authorizationHeader);
  if (fromUserinfo) return { userId: fromUserinfo, roles: [] as string[] };
  return jwt;
}

export function getOidcIdentitySummary() {
  const cfg = getOidcPublicConfig();
  return {
    ...cfg,
    trustGateway: getRagAgentEnv().oidcTrustGateway,
    verifyMode: process.env.RAG_OIDC_JWT_SECRET ? "hs256" : cfg.enabled ? "gateway" : "off",
  };
}
