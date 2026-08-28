import { LoginForm } from "./login-form";
import { AppBrand } from "@/components/app-brand";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ config?: string; password?: string }> }) {
  const parameters = await searchParams;
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card-top">
          <AppBrand compact />
          <ThemeSwitcher />
        </div>
        <span className="eyebrow">PRIVATE TRAVEL NOTE</span>
        <h1 id="login-title">나의 여정에 로그인</h1>
        <p className="login-intro">저장된 여행 계획은 등록된 계정으로만 확인할 수 있습니다.</p>
        {parameters.password === "changed" ? <p className="login-success" role="status">비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.</p> : null}
        <LoginForm configurationMissing={parameters.config === "missing"} />
      </section>
    </main>
  );
}
