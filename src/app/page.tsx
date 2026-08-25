import { TripPlanner } from "@/components/trip-planner";

export default function Home() {
  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="여정 홈">
          <span className="brand-mark" aria-hidden="true">
            여
          </span>
          <span>여정</span>
        </a>
        <span className="header-note">나의 여행 노트</span>
      </header>

      <div className="page-grid" id="main-content">
        <section className="intro-panel" aria-labelledby="intro-title">
          <span className="eyebrow">TRAVEL NOTE</span>
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

        <TripPlanner />
      </div>
    </main>
  );
}
