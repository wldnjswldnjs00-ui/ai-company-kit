# AI 본사 (ai-company-kit)

- 판매용 "AI 부서" 템플릿. Cloudflare Worker(Hono) + Supabase + Gemini 무료 티어(선택: Claude).
- 구매자가 입력하는 값은 5개뿐(SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, DASHBOARD_PASSWORD). 세션·웹훅 비밀값은 `src/settings.ts` 에서 파생하고, 회사 소개·CEO 채팅·대시보드 주소는 설치 화면이 `settings` 표에 저장한다. 새 설정을 추가할 때도 구매자가 Cloudflare 를 만지지 않게 한다.
- 회사별 내용은 코드에 쓰지 않는다: 회사 소개(`charter.ts` 의 Company), 부서 카탈로그(`departments.ts`), 부서별 직무는 DB 의 `departments.job` 으로 고칠 수 있다.
- **무료 원칙**: 자동으로 유료 API 로 넘어가는 경로를 만들지 않는다. 유료 두뇌는 `BRAIN_PROVIDER=claude` 일 때만. LLM 호출은 반드시 `src/brain/index.ts` 의 `think()` 를 거친다(개인정보 마스킹 + 하루 한도).
- AI 는 돈·계정·외부 게시·고객 연락을 스스로 하지 않는다. 결재로만 올린다.
- DB 스키마는 `supabase/setup.sql` 한 파일. 여러 번 실행해도 안전해야 한다(if not exists, on conflict do nothing).
- 설치 화면의 모든 실패에는 "어디서 무엇을 고치는지" 문장을 붙인다.
- 커밋 전: `npx tsc --noEmit`, `npx vitest run`, `npx wrangler deploy --dry-run`.
- 버전을 올릴 때: `src/version.ts` 의 KIT_VERSION, README 맨 위 버전, README **업데이트 기록** 표에 한 줄(바뀐 것 / 구매자가 해야 할 일: 파일 교체만인지, SQL 다시 실행인지, 새 값이 필요한지)을 함께 고친다. DB 가 바뀌면 setup.sql 에 넣고 "SQL 다시 실행" 을 적는다.
- 판매용 ZIP 이름은 `AI기업만들기_<버전>.zip`(예: `AI기업만들기_1.2.zip`). 압축 안 폴더 이름도 같게: `git archive --format=zip --prefix="AI기업만들기_<버전>/" -o "AI기업만들기_<버전>.zip" HEAD`. 만들기 전에 SEVN·Pi·개인 흔적과 .dev.vars 가 없는지 검사한다.

## 판매 현황과 다음 버전
- 1.0: 2026-09-30 크몽 등록, 가격 59,000원. 가격 인상 약속은 하지 않았다(판매 글에 "10개 팔리면 인상" 같은 문구 없음).
- 사장님 요청이나 수정이 생기면, 구매자에게 의미 있는 것(새 기능, 설치가 쉬워짐, 버그 수정)은 아래 **다음 버전 대기 목록**에 한 줄씩 쌓는다.
- 대기 목록이 3~5개 이상 쌓이거나, 구매자에게 급한 버그 수정이 생기면 사장님께 먼저 "이 정도면 1.x 로 올려도 됩니다"라고 알린다. 사장님이 정하면: version.ts, README 맨 위 버전, 업데이트 기록 표, ZIP 이름(AI기업만들기_<버전>.zip)을 함께 바꾼다.
- 크몽 상세 설명에 버전 숫자를 적었다면 그것도 바꾸시라고 알린다.

### 다음 버전 대기 목록
- (없음)
