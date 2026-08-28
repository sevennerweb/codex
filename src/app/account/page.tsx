import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PasswordForm } from "./password-form";
import { BackupManager } from "./backup-manager";
import { getAuthenticatedAccountFromToken } from "@/lib/auth-server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { AppBrand } from "@/components/app-brand";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const account = await getAuthenticatedAccountFromToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!account) redirect("/login");

  return (
    <main className="login-shell">
      <section className="login-card account-card" aria-labelledby="account-title">
        <div className="login-card-top">
          <AppBrand href="/" compact />
          <ThemeSwitcher />
        </div>
        <span className="eyebrow">ACCOUNT</span>
        <h1 id="account-title">비밀번호 변경</h1>
        <p className="login-intro"><strong>{account.username}</strong> 계정의 비밀번호를 변경합니다. 변경 후에는 다시 로그인해야 합니다.</p>
        <PasswordForm />
        {account.role === "admin" ? <BackupManager /> : null}
        <Link className="account-back-link" href="/">여행 화면으로 돌아가기</Link>
      </section>
    </main>
  );
}
