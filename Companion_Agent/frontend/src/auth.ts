export type AuthUser = {
  user_id: string;
  username: string;
  display_name: string;
};

const STORAGE_KEY = "companion_auth_user";

export function loadAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AuthUser;
    if (!data?.user_id || !data?.username) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveAuthUser(user: AuthUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function registerAccount(
  username: string,
  password: string,
  displayName = "",
): Promise<AuthUser> {
  const r = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      display_name: displayName,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    detail?: string | { msg?: string }[];
    user?: AuthUser;
  };
  if (!r.ok || !data.user) {
    const detail = data.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.msg).filter(Boolean).join("；")
          : "注册失败";
    throw new Error(msg || "注册失败");
  }
  return data.user;
}

export async function loginAccount(username: string, password: string): Promise<AuthUser> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = (await r.json().catch(() => ({}))) as {
    detail?: string | { msg?: string }[];
    user?: AuthUser;
  };
  if (!r.ok || !data.user) {
    const detail = data.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.msg).filter(Boolean).join("；")
          : "登录失败";
    throw new Error(msg || "登录失败");
  }
  return data.user;
}
