import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TripPlanner } from "@/components/trip-planner";
import { AppBrand } from "@/components/app-brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getAuthenticatedAccountFromToken } from "@/lib/auth-server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-session";

export default async function Home() {
  const cookieStore = await cookies();
  const account = await getAuthenticatedAccountFromToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!account) redirect("/login");

  return (
    <main className="app-shell">
      <header className="site-header">
        <AppBrand href="#main-content" />
        <div className="header-actions">
          <span className="header-note">{account.username} 계정</span>
          <ThemeSwitcher />
          <a className="account-link" href="/account">
            <span className="desktop-label">계정 관리</span>
            <span className="mobile-label">계정</span>
          </a>
          <form action="/api/auth/logout" method="post">
            <button className="logout-button" type="submit">로그아웃</button>
          </form>
        </div>
      </header>

      <div className="page-grid" id="main-content">
        <section className="intro-panel" aria-labelledby="intro-title">
          <span className="eyebrow">PLAN · MOVE · REMEMBER</span>
          <h1 id="intro-title">떠나기 전의 설렘부터 기록하세요.</h1>
          <p>
            여행 이름과 날짜를 정하면, 앞으로 항공편과 장소를 채워 넣을
            나만의 일정표가 시작됩니다.
          </p>
          <div className="route-art" aria-hidden="true">
            <span className="route-dot route-dot-start" />
            <span className="route-line" />
            <span className="route-plane">✦</span>
            <span className="route-dot route-dot-end" />
          </div>
        </section>

        <TripPlanner accountId={account.id} />
      </div>
    </main>
  );
}
