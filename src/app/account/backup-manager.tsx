"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeTripBackup, type TripBackup } from "@/lib/trip-backup-schema";

type TripVersionResponse = { trip?: { version?: number }; error?: string };

export function BackupManager() {
  const router = useRouter();
  const [backup, setBackup] = useState<TripBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function selectBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setBackup(null);
    setFileName("");
    setConfirmation("");
    setAcknowledged(false);
    setError("");
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("1MB 이하의 여행 백업 파일을 선택해 주세요.");
      event.target.value = "";
      return;
    }

    setPending(true);
    try {
      const parsed = normalizeTripBackup(JSON.parse(await file.text()));
      if (!parsed) throw new Error("지원하지 않거나 손상된 여행 백업입니다.");
      const response = await fetch("/api/trips/current", { cache: "no-store" });
      const payload = await response.json() as TripVersionResponse;
      if (!response.ok) throw new Error(payload.error ?? "현재 여행 버전을 확인하지 못했습니다.");
      const version = Number(payload.trip?.version ?? 0);
      if (!Number.isInteger(version) || version < 0) throw new Error("현재 여행 버전이 올바르지 않습니다.");
      setBackup(parsed);
      setFileName(file.name);
      setExpectedVersion(version);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "백업 파일을 확인하지 못했습니다.");
      event.target.value = "";
    } finally {
      setPending(false);
    }
  }

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backup || !acknowledged || confirmation !== backup.trip.name) {
      setError("교체 안내를 확인하고 복원할 여행 이름을 정확히 입력해 주세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, expectedVersion, confirmation }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "여행 백업을 복원하지 못했습니다.");
      router.replace("/");
      router.refresh();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "서버에 연결할 수 없습니다.");
    } finally {
      setPending(false);
    }
  }

  const itemCount = backup
    ? (backup.sections.schedule?.length ?? 0)
      + (backup.sections.flightSearch?.length ?? 0)
      + (backup.sections.selectedFlights?.length ?? 0)
      + (backup.sections.localInfo?.videos.length ?? 0)
      + (backup.sections.train?.length ?? 0)
    : 0;

  return (
    <section className="backup-manager" aria-labelledby="backup-title">
      <div>
        <span className="eyebrow">ADMIN BACKUP</span>
        <h2 id="backup-title">여행 데이터 백업</h2>
        <p>현재 관리자 여행의 모든 일정과 링크를 JSON 파일로 보관하거나, 이전 백업으로 교체할 수 있습니다.</p>
      </div>
      <a className="secondary-button backup-download" href="/api/admin/backup" download>현재 여행 내보내기</a>

      <form className="backup-form" onSubmit={restore} noValidate>
        <div className="field-group">
          <label htmlFor="backup-file">백업 파일 선택</label>
          <input id="backup-file" type="file" accept="application/json,.json" onChange={(event) => void selectBackup(event)} disabled={pending} />
          <span className="field-hint">이 앱에서 내보낸 1MB 이하의 JSON 파일만 사용할 수 있습니다.</span>
        </div>

        {backup ? (
          <div className="backup-preview" role="status">
            <strong>{backup.trip.name}</strong>
            <span>{backup.trip.startDate} → {backup.trip.endDate}</span>
            <small>{fileName} · 저장 항목 {itemCount}개</small>
          </div>
        ) : null}

        {backup ? (
          <>
            <label className="backup-acknowledge">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={pending} />
              <span>현재 관리자 여행과 모든 세부 정보가 이 백업으로 교체되는 것을 이해했습니다.</span>
            </label>
            <div className="field-group">
              <label htmlFor="backup-confirmation">확인을 위해 여행 이름 입력</label>
              <input id="backup-confirmation" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} placeholder={backup.trip.name} disabled={pending} autoComplete="off" />
            </div>
          </>
        ) : null}

        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button className="danger-button" type="submit" disabled={!backup || !acknowledged || confirmation !== backup.trip.name || pending}>
          {pending ? "확인 중…" : "선택한 백업으로 복원"}
        </button>
      </form>
    </section>
  );
}
