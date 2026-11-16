# 행정누리 전자민원 (haengjeongnuli e-Petition)

국민용 인터넷 민원 서비스입니다. 공무원용 **행정누리** 내부 시스템의 연동 API(`/api/epetition/v1/**`)만 부르고,
행정누리 DB에는 직접 붙지 않습니다. 민원 내용·개인정보는 이 서버의 DB나 로그에 남기지 않습니다.

```
국민 브라우저 ──HTTPS──▶ 행정누리 전자민원 (DMZ, 이 저장소)
                               │  서버 대 서버 호출만 (HMAC-SHA256 서명)
                               ▼
                         행정누리 내부 시스템 (/api/epetition/v1/**)
```

- Node.js 20 이상, **외부 패키지 없음** (`npm install` 필요 없음)
- 기능: 민원 신청(질의·건의·고충·기타), 처리상황 조회, 공개 상담 목록·상세, 행정처분 공개

## 빠르게 해 보기 (모의 행정누리 포함)

```bash
npm run dev
```

http://127.0.0.1:8080 을 엽니다. `mock/mock-nuri.js`는 규격의 인증·응답 꼴만 흉내 내는 **개발용** 서버입니다.
(처리기한은 실제 계산을 하지 않고, 비밀번호 해시도 BCrypt 가 아닙니다.)

## 운영 설정

`.env.example`을 참고해 환경변수로 넣습니다. 비밀값은 코드·저장소에 넣지 마세요.

| 환경변수 | 뜻 |
|---|---|
| `NURI_BASE_URL` | 행정누리 내부 시스템 주소 (예: `https://nuri.internal:8443`) |
| `EP_SECRET` | 서명 비밀값. 행정누리 `APP_EPETITION_SECRET`과 같은 값, **영문·숫자·기호 32자 이상 (한글 X)** |
| `EP_DEMO_NOTICE` | `true`면 모든 화면 위에 "시험 중인 서비스, 실제 개인정보를 넣지 마세요" 띠를 보여 줌. 시험으로 다른 사람에게 열 때 켜세요 |
| `EP_ALLOW_HTTP` | `true`면 `NURI_BASE_URL`에 `http://`를 허용 (내 PC 시험 전용). 운영은 `https://`만 — 이름·연락처·조회 비밀번호가 오가기 때문 |
| `NURI_CA_FILE` | (선택) 행정누리 인증서가 사설 CA일 때 CA 파일 |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | (선택) 이 서버가 직접 HTTPS를 받을 때. 비우면 앞단 프록시가 TLS를 끝낸다고 봄 |
| `TRUST_PROXY` | 앞단 프록시가 `X-Forwarded-For`를 붙이면 `true` |
| `COOKIE_SECURE` | 운영은 반드시 `true` |
| `ORG_NAME`, `ORG_CONTACT`, `PRIVACY_RETENTION` | 화면 문구 (보유기간은 행정누리 민원 기록 보존기간과 맞춤) |

행정누리 쪽에서는 `APP_EPETITION_ENABLED=true`, 같은 `APP_EPETITION_SECRET`, 그리고
`APP_EPETITION_NETWORKS`에 **이 서버가 행정누리로 나갈 때의 주소**를 넣어야 합니다.
두 서버 모두 시각을 NTP로 맞추세요 (±300초를 넘으면 `bad_timestamp`).

```bash
npm start
```

## 규격 대응

| 규격 | 구현 위치 |
|---|---|
| 3. 서명 (`X-EP-Timestamp/Nonce/Signature`, `X-EP-Client-IP`) | `src/signature.js`, `src/nuriClient.js` — 본문은 한 번만 직렬화해 서명한 바이트 그대로 보내고, 경로·쿼리는 직접 퍼센트 인코딩한 문자열을 요청 줄에 그대로 씀 |
| 서명 예시 값 | `test/signature.test.js` (행정누리 `EPetitionSignatureTest`와 같은 값) |
| 4. 응답 형식, `Cache-Control: no-store` | `src/nuriClient.js`, `src/security.js` (국민 화면 전부 no-store) |
| 5-1 접수 | `/complaints/new` → `POST /complaints`. 법정민원은 받지 않고 정부24·창구 안내. 처리기한은 행정누리 값만 표시 |
| 5-2 조회 | `/lookup` (POST). `not_matched`는 구별 없이 안내, `locked`(423)는 행정누리 안내 문구 표시 |
| 5-3·5-4 공개 상담 | `/consultations`, `/consultations/{id}` |
| 5-5 행정처분 | `/dispositions` |
| 6. 지킬 것 | HSTS·CSP 등 보안 헤더, 쿠키 `Secure; HttpOnly; SameSite=Strict`, CSRF(이중 제출 쿠키), 국민 IP별 횟수 제한(접수 10분 5회, 조회 10분 10회, 목록 1분 60회), 자동입력 방지, 모든 출력 HTML 이스케이프, `remedy` 별도 강조 표시, 개인정보 동의 안내(개인정보 보호법 제15조), 접수 완료 화면 안내, 요청 본문 로그 금지(접속 기록은 경로만) |

## 운영 전에 꼭 바꿀 것

- **자동입력 방지**: 기본 제공 CAPTCHA는 메모리에 저장하는 간단한 숫자 그림입니다. 서버를 여러 대로 돌리거나
  웹 접근성(음성 안내 등)을 맞추려면 기관 표준 CAPTCHA로 바꾸세요 (`createApp({ captcha })`로 교체 가능).
- **요청 횟수 제한**도 메모리 기준이라 서버마다 따로 셉니다. 여러 대면 앞단(WAF·프록시)에서도 제한하세요.
- `PRIVACY_RETENTION`을 기관 기록관리 기준 보존기간으로 적으세요.

## 아직 없는 것 (행정누리 쪽 API가 먼저 필요)

첨부파일 접수, 법정민원 신청(정부24 연계), 본인확인(CI 등 전달 필드 협의), 조회 비밀번호 재설정.

## 시험

```bash
npm test
```
