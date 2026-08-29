# webapp_travel 작업 규칙

Windows-first Next.js App Router 프로젝트다. TypeScript strict 모드와 pnpm을 사용한다.

- 페이지와 API route: `src/app`
- 공용 UI 컴포넌트: `src/components`
- 명령은 `package.json`에 정의된 pnpm 스크립트를 사용한다.

## 작업 원칙

- 사용자가 요청한 결과를 기준으로 작업을 끝까지 수행한다.
- 구현·수정 요청은 관련 코드를 조사하고, 필요한 경우 짧게 계획한 뒤 구현·검증한다.
- 리뷰·설명·진단 요청에서는 명시적으로 요청받지 않는 한 파일을 수정하지 않는다.
- 계획만 요청받은 경우 구현하지 않는다.
- 기존 사용자 변경과 관련 없는 파일을 건드리지 않는다.
- 가장 작고 직접적인 해결책을 우선하며 불필요한 추상화나 의존성을 추가하지 않는다.
- 프로덕션 의존성 추가, 비밀값 변경, 데이터 삭제, 외부 배포 전에는 사용자 승인을 받는다.

## Windows 환경

- PowerShell을 기본 셸로 사용한다.
- 경로는 인용하고 파일 작업에는 가능한 경우 `-LiteralPath`를 사용한다.
- 전역 도구를 설치하지 말고 프로젝트 로컬 도구나 pnpm 명령을 사용한다.

## 검증

코드 변경 후 적용 가능한 검증을 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm typecheck`
3. 관련 테스트 — `package.json`에 테스트 스크립트가 있을 때
4. `pnpm build`

실패한 검사는 원인을 수정한 후 다시 실행한다. 테스트를 통과시키기 위해 기존 검사를 삭제하거나 약화하지 않는다.

UI 변경은 실제 앱에서 다음을 확인한다.

- 기본 사용자 시나리오와 중요한 오류 또는 경계 시나리오
- 키보드 조작, 접근 가능한 이름, visible focus
- 약 375px, 768px, 데스크톱 화면
- loading, empty, error, success 상태 중 도달 가능한 상태

API 변경은 정상 요청과 잘못된 입력을 각각 확인한다. 앱을 실행할 수 없다면 정확한 원인과 대신 수행한 검증을 보고한다.

## 품질 기준

- 사용자 입력은 시스템 경계에서 검증한다.
- 비밀값과 권한이 필요한 처리는 브라우저 코드에 포함하지 않는다.
- 의미 있는 HTML, 반응형 레이아웃, reduced-motion 설정을 유지한다.
- 변경 후 최종 diff에서 보안, 접근성, 성능, 회귀 및 불필요한 변경을 확인한다.

## Code Review Rules

- finding을 심각도 순으로 먼저 보고한다.
- 각 finding에 정확한 파일과 줄, 사용자 영향, 권장 수정 방법을 포함한다.
- 요구사항 위반, 인증·권한 문제, 비밀 노출, injection, 접근성 저하, 반응형 레이아웃 손상, 처리되지 않은 사용자 상태를 우선 확인한다.
- finding이 없다면 명시적으로 밝히고 남은 검증 공백이나 위험을 적는다.

## 완료 보고

완료 보고에는 다음을 포함한다.

- 변경 내용
- 통과한 명령과 수동 QA 시나리오
- 검증하지 못한 항목과 이유

## 서버 빌드 및 배포

- 서버 배포 작업 전에는 루트의 `DEPLOYMENT.md`를 읽고 현재 인프라와 권장 절차를 확인한다.
- 1GB급 운영 VM에서 Next.js Docker 이미지를 직접 빌드하는 것은 장애 복구용 최후 수단으로만 사용한다. 기본 방향은 별도 빌더에서 Git SHA 태그 이미지를 한 번 만들고 운영 VM에서는 `docker pull` 또는 `docker load` 후 컨테이너만 교체하는 것이다.
- 같은 커밋의 이미지를 VM과 Cloud Shell 등 여러 곳에서 동시에 빌드하지 않는다.
- 새 컨테이너가 준비되기 전에는 기존 컨테이너를 중지하지 않는다. 데이터 볼륨과 인증 환경 파일을 유지하고, 직전 컨테이너는 사용자 검증이 끝날 때까지 롤백용으로 보관한다.
- 외부 배포는 사용자 승인을 받은 경우에만 수행한다. 사용자가 직접 1차 검증하겠다고 한 배포에서는 기본 상태 확인 후 추가 조작을 멈춘다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
