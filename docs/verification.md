# 인증·인가 검증 근거

2026년 11월 26일에 작성된 코드로 로컬 SQLite를 사용하는 자동 검증을 실행했습니다. 테스트는 두 임시 계정과 메모리 DB를 사용합니다. 사용자의 실사용 기록은 별도의 양식에 실제로 채웁니다.

검증은 빌드된 서버 핸들러에 요청을 전달하는 방식으로 수행했습니다. 실행 환경의 네트워크 제한으로 브라우저 화면 및 온라인 배포 환경에서의 확인은 보류되었습니다.

```text
node scripts/build.mjs
node --test scripts/auth.test.mjs
```

실행 결과는 통과 1개, 실패 0개입니다. 테스트는 아래 HTTP 상태와 응답을 실제로 확인했습니다. 세션 쿠키, 입력 비밀번호와 저장 해시 원문은 출력에서 가렸습니다. 기록 ID는 A와 B로 치환했습니다.

| 조건 | 요청 | 응답 |
| --- | --- | --- |
| 로그인 전 첫 화면 | GET / | 200 · 로그인 HTML |
| 로그인 전 보호 화면 | GET /diary | 303 · Location /login |
| 로그인 전 기록 API | GET /api/diaries | 401 · 로그인이 필요합니다. |
| A 회원가입 | POST /api/signup · 비밀번호 [마스킹] | 201 · 사용자명, Set-Cookie [마스킹] |
| A 로그인 | POST /api/login · 비밀번호 [마스킹] | 200 · 사용자명, 새 Set-Cookie [마스킹] |
| 로그인 이전 쿠키 | GET /api/me · 이전 Cookie [마스킹] | 401 · 로그인이 필요합니다. |
| A 자기 기록 생성 | POST /api/diaries · A Cookie [마스킹] | 201 · A 기록 ID |
| A 자기 기록 읽기 | GET /api/diaries/[A 기록 ID] · A Cookie [마스킹] | 200 · 제목, 날짜, 계획, 실행, 회고 |
| A 자기 기록 수정 | PUT /api/diaries/[A 기록 ID] · A Cookie [마스킹] | 200 · A 기록 ID |
| A 자기 기록 삭제 | DELETE /api/diaries/[A 기록 ID] · A Cookie [마스킹] | 200 · { "deleted": true } |
| A 목록 | GET /api/diaries · A Cookie [마스킹] | 200 · A 기록만 포함 |
| B 목록 | GET /api/diaries · B Cookie [마스킹] | 200 · B 기록만 포함 |
| A의 B 기록 읽기 | GET /api/diaries/[B 기록 ID] · A Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| A의 B 기록 수정 | PUT /api/diaries/[B 기록 ID] · A Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| A의 B 기록 삭제 | DELETE /api/diaries/[B 기록 ID] · A Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| B의 A 기록 읽기 | GET /api/diaries/[A 기록 ID] · B Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| B의 A 기록 수정 | PUT /api/diaries/[A 기록 ID] · B Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| B의 A 기록 삭제 | DELETE /api/diaries/[A 기록 ID] · B Cookie [마스킹] | 404 · 기록을 찾을 수 없습니다. |
| B 로그아웃 | POST /api/logout · B Cookie [마스킹] | 200 · { "signedOut": true } |
| B 로그아웃 직전 쿠키 재사용 | GET /api/diaries · 동일한 B Cookie [마스킹] | 401 · 로그인이 필요합니다. |
| A의 최초 규칙 저장 | POST /api/rules · A Cookie [마스킹] | 201 · { "saved": true } |
| A의 1회 규칙 변경 | PUT /api/rules · A Cookie [마스킹] | 200 · { "saved": true } |
| A의 2회차 규칙 변경 | PUT /api/rules · A Cookie [마스킹] | 409 · 3일차 시작 전까지 한 번 변경 가능 |
| 최초 저장일을 과거로 설정한 검증 DB | PUT /api/rules · B Cookie [마스킹] | 409 · 기한 경과로 변경 거부 |

DB 조회로 비밀번호 저장값이 입력 원문과 다르고 salt가 16바이트, 해시가 32바이트임을 확인했습니다. HTTPS 요청에서 세션 쿠키의 `HttpOnly`, `Secure`, `SameSite=Lax`와 만료 설정을 검사했습니다.

### 참고

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
