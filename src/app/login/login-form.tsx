"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ configurationMissing }: { configurationMissing: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(configurationMissing ? "서버의 로그인 설정이 아직 완료되지 않았습니다." : "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "로그인하지 못했습니다.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <label htmlFor="login-username">아이디</label>
      <input id="login-username" name="username" autoComplete="username" required maxLength={64} disabled={pending || configurationMissing} />

      <label htmlFor="login-password">비밀번호</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={pending || configurationMissing} />

      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button className="primary-button login-button" type="submit" disabled={pending || configurationMissing}>
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
