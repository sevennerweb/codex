# 여행 플래너 빌드·배포 기록

이 문서는 다음 작업자가 저사양 운영 VM에서 긴 Docker 빌드를 반복하지 않도록 현재 구조와 권장 배포 방식을 기록한다.

## 현재 인프라

- GCP 프로젝트: `arched-tape-506711-t4`
- Compute Engine VM: `n8n-instance` (`us-west1-b`)
- 외부 주소: `https://skyline-impatient-resubmit.ngrok-free.dev`
- 앱 컨테이너: `travel-app`
- 앱 포트: VM의 `127.0.0.1:3000`
- 영속 데이터: `/opt/travel-app/data` → 컨테이너 `/app/data`
- 인증 환경 파일: `/opt/travel-app/auth.env`
- 컨테이너 재시작 정책: `unless-stopped`

`n8n`은 여행 앱 실행에 필요하지 않다. 여행 앱, ngrok 터널, n8n은 별도 프로세스다.

## 관찰된 병목

2026-08-29 배포에서 약 1GB 메모리의 VM이 `docker build` 중 Next.js 프로덕션 컴파일과 빌드 캐시 기록에 약 35분을 사용했다. 현재 `Dockerfile`은 `package.json`과 lockfile을 소스보다 먼저 복사하므로 의존성 레이어 캐시는 이미 활용한다. 소스 변경마다 필요한 Next.js 컴파일을 저사양 VM에서 실행하는 것이 핵심 병목이며, Dockerfile의 작은 캐시 조정만으로는 크게 줄어들지 않는다.

같은 커밋을 VM과 Cloud Shell에서 동시에 빌드하면 시간과 자원만 중복 사용한다. 한 곳을 빌더로 정하고 결과 이미지만 전달한다.

## 권장 구조

장기적으로는 운영 VM을 빌드 머신으로 사용하지 않는다.

1. 로컬에서 기능을 구현하고 `lint`, `typecheck`, 필요한 QA를 수행한다.
2. Git SHA를 불변 이미지 태그로 사용한다. 예: `webapp-travel:caf2293`.
3. Google Cloud Build + Artifact Registry 또는 GitHub Actions + GHCR 중 하나에서 Linux `amd64` 이미지를 한 번 빌드한다.
4. 운영 VM은 완성된 이미지를 `docker pull`하고 기존 데이터 볼륨·환경 파일로 새 컨테이너를 시작한다.
5. `/login`의 HTTP 200, 비로그인 `/`의 `/login` 리다이렉트, 컨테이너 로그만 기본 확인한다.
6. 직전 컨테이너는 중지 상태로 남겨 사용자 검증이 끝날 때까지 롤백 가능하게 한다.

현재는 이미지 레지스트리 자동 배포가 구성되어 있지 않다. Artifact Registry/Cloud Build 또는 GHCR 워크플로를 만들려면 서비스 활성화, 저장소 및 권한·비밀값 설정이 필요하므로 먼저 사용자 승인을 받는다. GCP VM을 이미 사용하므로 기본 권장안은 Cloud Build + Artifact Registry다.

## 레지스트리 도입 전의 단기 대안

Docker Desktop 또는 충분한 사양의 별도 빌더가 있다면 다음 순서가 VM 직접 빌드보다 낫다.

1. 빌더에서 `linux/amd64` 이미지 하나를 만든다.
2. `docker save`로 tar 파일을 만들고 `gcloud compute scp`로 VM에 전송한다.
3. VM에서 `docker load`한 뒤 컨테이너만 교체한다.

전송할 이미지가 커질 수 있으므로 반복 배포가 시작되면 이 방식 대신 레지스트리를 도입한다. 로컬 Docker를 사용할 수 없다면 기존 VM 빌드는 마지막 대안으로만 사용하고, 이미지를 백그라운드에서 한 번만 빌드하며 현재 앱 컨테이너는 계속 실행해 둔다.

## 안전한 컨테이너 교체 원칙

- 새 이미지 존재 여부를 확인한 뒤 교체한다.
- 기존 `travel-app`은 삭제하지 않고 커밋이 포함된 롤백 이름으로 변경해 중지한다.
- 새 컨테이너에는 `/opt/travel-app/auth.env`와 `/opt/travel-app/data:/app/data`를 그대로 연결한다.
- 새 컨테이너 시작 실패 시 실패한 컨테이너만 제거하고 직전 컨테이너 이름과 실행 상태를 복원한다.
- 사용자 데이터가 있는 `/opt/travel-app/data`는 배포 과정에서 삭제하거나 덮어쓰지 않는다.
- 사용자 검증 전에는 롤백 컨테이너와 직전 이미지를 정리하지 않는다.

## 완료 기준

사용자가 직접 1차 검증하겠다고 한 경우 에이전트의 배포 완료 기준은 다음으로 제한한다.

- 새 컨테이너가 기대한 Git SHA 이미지로 실행 중이다.
- 내부 `/login`이 200으로 응답한다.
- 인증되지 않은 `/` 요청이 `/login`으로 이동한다.
- ngrok 외부 주소가 응답한다.
- 시작 로그에 치명적 오류가 없다.

이 조건을 확인하면 추가 계정 데이터 변경이나 광범위한 UI 조작을 하지 않고 사용자 피드백을 기다린다.
