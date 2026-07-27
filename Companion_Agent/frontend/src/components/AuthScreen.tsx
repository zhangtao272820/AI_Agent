import { useState } from "react";
import { loginAccount, registerAccount, type AuthUser } from "../auth";

type Props = {
  onAuthed: (user: AuthUser) => void;
};

export default function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await loginAccount(username.trim(), password)
          : await registerAccount(username.trim(), password, displayName.trim());
      onAuthed(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gal-auth-screen">
      <div
        className="gal-auth-bg"
        style={{
          backgroundImage: "url(/api/bgs/title.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="gal-auth-shade" />
      <div className="gal-auth-card">
        <p className="gal-auth-kicker">邂逅的少女</p>
        <h1 className="gal-auth-title">{mode === "login" ? "登录故事" : "创建角色档案"}</h1>
        <p className="gal-auth-sub">每位旅人的存档彼此独立。结局，只能亲自走完。</p>

        <div className="gal-auth-tabs" role="tablist">
          <button
            type="button"
            className={`gal-auth-tab${mode === "login" ? " gal-auth-tab--active" : ""}`}
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`gal-auth-tab${mode === "register" ? " gal-auth-tab--active" : ""}`}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>

        <label className="gal-auth-field">
          <span>用户名</span>
          <input
            value={username}
            autoComplete="username"
            disabled={busy}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="你的旅人代号"
          />
        </label>
        {mode === "register" && (
          <label className="gal-auth-field">
            <span>显示名（可选）</span>
            <input
              value={displayName}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="如何称呼你"
            />
          </label>
        )}
        <label className="gal-auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 4 位"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {error && <p className="gal-auth-error">{error}</p>}

        <button
          type="button"
          className="gal-action-btn gal-action-btn--primary gal-auth-submit"
          disabled={busy || !username.trim() || password.length < 4}
          onClick={() => void submit()}
        >
          {busy ? "请稍候…" : mode === "login" ? "进入世界" : "创建档案"}
        </button>
      </div>
    </div>
  );
}
