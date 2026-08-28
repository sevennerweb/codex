"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setError("새 비밀번호와 확인 값이 일치하지 않습니다.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "비밀번호를 변경하지 못했습니다.");
        return;
      }
      form.reset();
      router.replace("/login?password=changed");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <label htmlFor="current-password">현재 비밀번호</label>
      <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} disabled={pending} />

      <label htmlFor="new-password">새 비밀번호</label>
      <input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby="password-hint" disabled={pending} />
      <span className="field-hint" id="password-hint">8자 이상으로 입력해 주세요.</span>

      <label htmlFor="password-confirmation">새 비밀번호 확인</label>
      <input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} />

      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button className="primary-button login-button" type="submit" disabled={pending}>
        {pending ? "변경 중…" : "비밀번호 변경"}
      </button>
    </form>
  );
}
