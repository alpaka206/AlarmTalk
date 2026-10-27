# 아침 소식

> 관심 기업(최대 3곳)의 **전자공시**와 **정책브리핑 정책뉴스**를 원문 링크와 함께 보여 준다. 2026-10-26 서버 쪽을
> 만들었다(오너 v1.3 계획 W14). 같은 날 두 앱의 화면(더보기 → 아침 소식)을 붙였다 — §8.

## 1. 무엇을 하고, 무엇을 하지 않는가

| 한다 | 하지 않는다 |
| --- | --- |
| 관심 기업 공시의 **보고서명·접수 날짜·비고·원문 링크**를 보여 준다 | 주가·시세·등락을 보여 주지 않는다 |
| 정책뉴스의 **제목·짧은 요약·담당 부처·게시 날짜·원문 링크**를 보여 준다 | 공시·기사를 요약·해석·평가하지 않는다. 전망·추천·매수/매도 같은 투자 판단을 만들지 않는다 |
| 무엇을 **언제 확인했는지**(확인 시각)와 확인하지 못한 것을 함께 말한다 | 일반 언론 기사를 긁어 오지 않는다(스크래핑 없음). 정책브리핑 RSS 도 쓰지 않는다 — 2026-07-01 에 제공이 끝났다 |
| 글을 보는 것은 무료다 | 원천의 이미지·사진을 다시 싣지 않는다 |
| 항목 하나를 **200자 이하의 낭독 문단**으로 만든다(`composeBriefingSpeech`) | 목소리로 만드는 일은 이 기능이 하지 않는다 — 직접 입력 문구와 **같은 경로·같은 월 한도**로 간다([voice-and-message.md](voice-and-message.md)) |

⚠ **"새 공시 없음" 은 그 회차의 질의가 실제로 성공했을 때만 말한다.** 실패를 빈 목록으로 바꾸지 않는다(§4).

## 2. 원천

### OpenDART(금융감독원 전자공시) — 키 `OPENDART_API_KEY`

- **고유번호**(`corpCode.xml`): 응답이 ZIP 이고 안에 `CORPCODE.xml` 이 있다. 워커가 내장
  `DecompressionStream('deflate-raw')` 로 풀고(라이브러리 없음, `lib/briefing/zip.ts`) 행마다 고유번호(8자리)·기업명·
  종목코드·변경일을 읽는다. 비상장은 종목코드가 공백이다.
  - ⚠ **캐시에는 상장사만 담는다**(종목코드가 있는 행, 약 2,700곳). 원천 파일은 비상장(펀드·조합 포함)까지 10만 행이
    넘는데, 그걸 다 담으면 받는 날마다 10만 행을 쓰고 검색 한 번이 10만 행을 읽는다(Turso 행 읽기·쓰기 과금, 워커
    요청 하나의 바깥 호출 한도). '관심 기업' 은 상장사를 고르는 기능으로 정했다 — 비상장을 넣으려면 이 결정부터 바꾼다.
  - **공용 캐시**다(사람과 묶지 않는다). 사람마다 받지 않는다.
  - 받는 때: 크론이 한국 시각 06시대에 하루 한 번(마지막 성공에서 20시간이 지났을 때), 그리고 캐시가 비어 검색이
    아무것도 못 찾을 때 한 번. 둘 다 **잠금**(`briefing_fetch_state` 의 `corpcode` 행, 10분) 안에서만 받고, 실패하면
    10분 기다린다.
  - 상장사 행이 1,000 미만이거나 20,000 을 넘는 파일은 잘렸거나 틀린 것으로 보고 **캐시를 바꾸지 않는다**(그대로 쓰면
    '이번에 안 보인 행 지우기' 가 캐시를 비운다). 바꿀 때는 넣기·지우기를 한 batch(한 트랜잭션)로 보낸다.
- **공시 검색**(`list.json`): 관심 기업 하나씩, 한국 날짜로 **오늘 포함 7일**(`bgn_de`~`end_de`), 쪽당 100건, 최대 3쪽.
  3쪽을 넘기면 잘린 것이다(`complete: false`).
  - 접수번호(`rcept_no`)가 안정 id 이고, 원문 링크는 `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=<접수번호>` 다.
  - 접수일(`rcept_dt`)은 **날짜만** 있다. ⚠ 시각을 지어 붙이지 않는다 — 응답의 `receipt_date` 는 `YYYY-MM-DD` 하나다.
  - 원천이 다른 기업의 행을 섞어 주면 버린다(남의 공시를 이 기업 것으로 보여 주지 않는다).
  - 비고(`rm`)는 원문 그대로 `remarks` 에 두고, 아는 글자만 깃발로 푼다:

    | 글자 | 뜻 | 깃발 |
    | --- | --- | --- |
    | 유 · 코 · 넥 · 채 | 유가증권 · 코스닥 · 코넥스 · 채권상장법인 소관 | `market` = `kospi`·`kosdaq`·`konex`·`bond` |
    | 정 | 이 보고서를 낸 뒤 정정신고가 있었다 | `corrected_later` |
    | 철 | 이 보고서는 철회됐다 | `withdrawn` |
    | 연 | 연결 재무 부분 포함 | `consolidated` |
    | 공 | 공정거래위원회 공시 | `ftc` |
    | (보고서명) `[기재정정]`·`[첨부정정]`·`[정정명령부과]` 등 `[…정정…]` | 이 보고서 자체가 정정 관련이다 | `amended_report` |

### 정책브리핑 정책뉴스 — 키 `KOREA_POLICY_NEWS_API_KEY`

- 공공데이터포털(data.go.kr) 「문화체육관광부_정책브리핑_정책뉴스」 OpenAPI,
  `apis.data.go.kr/1371000/policyNewsService/policyNewsList`(`serviceKey`·`startDate`·`endDate`). **오늘 포함 2일**을 묻는다.
  응답은 XML 이다.
- 키는 data.go.kr **일반 인증키(Decoding)** 다(Encoding 키를 넣으면 이중 인코딩되어 30 이 난다 — 기상청 키와 같다).
- ⚠ **필드 이름은 실제 응답으로 확인하지 않았다**(키가 없었다). 공개된 연동 사례의 `<NewsItem>` 모양
  (`NewsItemId`·`ContentsStatus`·`Title`·`SubTitle1`·`DataContents`·`ApproveDate`·`MinisterCode`·`OriginalUrl`)으로 맞췄고,
  이름은 `lib/briefing/policy-news.ts` 의 `mapPolicyNewsFields` **한 곳**에만 있다. 확인 순서는 §7.
- 저장하는 것: 원문 링크(정책브리핑 `korea.kr` 주소만 — 아니면 그 항목을 버린다, http 는 https 로), 게시 날짜(시각을
  줬으면 시각도), 받은 시각, 내용 해시, 제목, **짧은 요약**(부제가 있으면 부제, 없으면 본문 앞 120자).
- 본문 HTML 은 글자로만 바꾼다 — `script`·`style` 은 내용째 버리고 태그를 지운다. 화면은 그 글자를 **텍스트로만**
  그린다(HTML 로 다시 해석하지 않는다). `ContentsStatus = D`(삭제)면 우리 캐시에서도 지운다.
- 문서형 선언(`<!DOCTYPE`)·엔티티 선언(`<!ENTITY`)이 있는 문서는 읽지 않는다 — 두 원천 모두(외부 엔티티를 풀지 않는다).

## 3. 출처 표시와 권리

- **OpenDART**: 출처는 "금융감독원 전자공시시스템(DART)" 이다. 공시 원문은 DART 에서 보게 하고(원문 링크), 우리는
  보고서명·접수일·비고만 옮긴다. 화면에 출처와 확인 시각을 함께 적는다.
- **정책브리핑**: 정책브리핑 콘텐츠는 **공공누리 제1유형(출처표시)** 으로 이용할 수 있다 — 화면에 "출처: 대한민국
  정책브리핑(www.korea.kr)" 과 원문 링크를 적는다. 다만 **개별 기사·사진에는 제3자 권리가 있을 수 있다**(기고·사진·
  외부 자료). 그래서 기사 전문을 옮기지 않고 제목·짧은 요약·원문 링크까지만 싣고, **이미지는 저장도 재게시도
  하지 않는다**(썸네일·원본 이미지 주소를 읽지 않는다).
- 앱 화면을 만들 때 출처 줄을 빼지 말 것 — 출처 표시가 이용 조건이다.

## 4. 캐시와 신선함

| 규칙 | 값 |
| --- | --- |
| 원천 하나(기업 하나·정책뉴스)를 다시 묻지 않는 시간 | **15분** — 같은 기업을 고른 사람끼리 나눠 쓴다 |
| 한국 날짜가 바뀌면 | 15분 안이어도 새 창으로 다시 묻는다 |
| 실패 뒤 같은 원천을 다시 묻기까지 | 60초 |
| 요청 한도(OpenDART 020 · data.go.kr 22) | 그 원천 전체를 **15분** 쉬고, 응답에 `Retry-After`·`retry_after_seconds` |
| 받아 둔 항목 보관 | 게시 날짜에서 30일(크론이 06시대 첫 틱에 지운다) |

- 다시 물어 **성공**하면 그 창의 항목을 바꾼다 — 같은 내용(해시)은 다시 쓰지 않고, 창 안에서 이번에 안 보인 공시는
  지운다(잘린 응답이면 지우지 않는다).
- 다시 물어 **실패**하면 전에 받아 둔 것을 **그때의 확인 시각**과 함께 보여 준다(`stale: true`, 기업은
  `status: 'stale'`). 한 번도 성공한 적이 없으면 `status: 'unavailable'` — 빈 목록이지만 **"없음" 이 아니다.**
- `complete: true` 는 모든 원천·관심 기업을 이번 창(15분) 안에 확인했고 잘린 것도 없다는 뜻이다. 앱은 `complete` 가
  거짓이면 "새 공시가 없어요" 라고 말하지 않는다.
- `fetched_at` 은 보여 주는 것 가운데 **가장 오래된** 확인 시각이다.
- **응답에 싣는 개수에도 끝이 있다** — 공시는 **기업마다** 20개(관심 기업 3곳이면 합 60), 정책뉴스는 20개. 기업마다 따로
  자르는 것은 공시가 많은 한 곳이 다른 관심 기업의 공시를 통째로 밀어내지 않게 하려는 것이다. 잘린 것이 있으면 원천을 다
  확인했어도 `complete: false` 다 — 나머지를 받을 길(쪽 넘기기)이 없는 것을 "다 보여 줬다" 고 하지 않는다.
- **같은 범위를 두 요청이 동시에 새로 받아도 늦게 시작한 쪽이 이긴다.** 먼저 시작해 옛 답을 든 요청이 나중에 끝나면 뒤
  요청이 넣은 공시를 지우고 고친 내용을 덮을 수 있었다(그 캐시를 15분 동안 다시 쓴다). 그래서 모든 쓰기(항목 넣기·고치기,
  사라진 항목 지우기, 성공·실패 표시)가 '이 범위의 마지막 성공이 내 시작보다 늦지 않은가' 를 같은 문장 안에서 본다 — 늦으면
  아무것도 쓰지 않는다. 원천을 두 번 부르는 것은 막지 않는다(15분 캐시가 끝나는 순간에만 겹친다).

## 5. API 와 오류

| 라우트 | 하는 일 |
| --- | --- |
| `GET /api/briefing/companies/search?q=&limit=` | 기업명 포함(`LIKE … ESCAPE`) 또는 종목코드 정확히. 검색어 1~30자(정리한 뒤), `limit` 은 1~20 으로 자른다 |
| `GET /api/briefing/interests` | 내 관심 기업(최대 3) |
| `PUT /api/briefing/interests` | `{ corp_codes: [...] }` 로 **통째 교체**. 8자리 숫자·서로 다름·최대 3·캐시에 있는 기업 |
| `GET /api/briefing/today` | `{ window, companies, disclosures, policy_news, fetched_at, stale, complete, errors }` — 일부가 실패해도 **200** |

- 관심 목록은 **인증이 정한 사람 id** 로만 읽고 쓴다 — 요청에 사람 id 를 받지 않는다. 탈퇴 파기가 지운다.
- HTTP 오류 코드: `BRIEFING_INVALID_QUERY`(400) · `BRIEFING_INVALID_INTERESTS`(400) · `BRIEFING_CORP_NOT_FOUND`(400, `missing`) ·
  `BRIEFING_NOT_CONFIGURED`(503 — 두 원천의 키가 다 없다, 검색은 OpenDART 키가 없고 캐시가 빌 때) ·
  `BRIEFING_CORP_CODES_NOT_READY`(503 + `Retry-After: 60` — 캐시를 받는 중) · DB 실패는 500 `INTERNAL_ERROR`.
- `errors[].code`(본문으로만 나간다):

  | 코드 | OpenDART | data.go.kr |
  | --- | --- | --- |
  | `BRIEFING_SOURCE_NOT_CONFIGURED` | 키 없음 | 키 없음 |
  | `BRIEFING_SOURCE_RATE_LIMITED` | 020 (HTTP 429) | 22 (HTTP 429) |
  | `BRIEFING_SOURCE_KEY_INVALID` | 010 · 011 · 012(IP) · 901 | 20 · 30 · 31 · 32(IP) · 33 |
  | `BRIEFING_SOURCE_MAINTENANCE` | 800 | — |
  | `BRIEFING_SOURCE_FAILED` | 900 · 014 · 021 · 100 · 101 · 모르는 값 · 전송 실패 · 읽을 수 없는 응답 | 그 밖의 값 · 전송 실패 · 읽을 수 없는 응답 |

  `013`(OpenDART)·`03`(data.go.kr)은 오류가 아니라 **빈 목록(성공)** 이다.
- 키 오류는 `briefing.source_failed` 를 error 로 남기고(우리 설정을 고쳐야 한다), 크론의 고유번호 받기에서 키가 거절되면
  Sentry 로도 올린다. ⚠ 요청 URL 에 키가 실리므로 URL 을 로그·오류에 싣지 않는다.

## 6. 낭독 문단

`composeBriefingSpeech(item, kstDate)` — 200자 이하(직접 입력 문구 상한과 같다), JS 길이로 센다.

- 공시: "10월 26일 확인한 ○○의 공시입니다. 보고서명은 …입니다. 자세한 내용은 원문에서 확인해주세요."
  철회된 공시는 "이 공시는 철회되었습니다." 를 더한다. `[기재정정]` 같은 괄호는 낭독용으로 풀어 쓴다.
- 정책뉴스: "10월 26일 확인한 정책브리핑 정책뉴스입니다. 제목은 …입니다. 자세한 내용은 원문에서 확인해주세요."
- 넘치면 기업명·보고서명·제목을 잘라 맞춘다(서러게이트 쌍을 가르지 않는다). 끝맺음 문장은 지킨다.
- ⚠ 전망·평가·추천과 "최신"·"새로운" 같은 단정의 말을 넣지 않는다 — 확인한 **날짜**를 말한다. 시각은 말하지 않는다.

## 7. 오너가 넣어야 할 것

1. **OpenDART 인증키** — opendart.fss.or.kr 에서 발급(무료, 하루 20,000건). `.dev.vars.{dev,prod}` 의
   `OPENDART_API_KEY` → `npm run secrets:sync:{dev,prod}`.
2. **정책브리핑 정책뉴스 서비스 키** — data.go.kr 에서 「문화체육관광부_정책브리핑_정책뉴스」 활용 신청 → **일반 인증키
   (Decoding)** 를 `KOREA_POLICY_NEWS_API_KEY` 로.
3. **IP 제한** — 두 원천 모두 키에 IP 를 묶을 수 있다(OpenDART 012, data.go.kr 32). Cloudflare Workers 의 나가는 IP 는
   고정되지 않으므로 **IP 제한을 걸지 않는다.** 걸려 있으면 `BRIEFING_SOURCE_KEY_INVALID` 로만 보인다.
4. **정책뉴스 실제 응답 확인** — 키를 받으면 dev 에서 한 번 불러 응답 XML 을 보고, `test/fixtures/briefing/policy-news-list.xml`
   을 실제 응답(개인정보 없음)으로 바꾼 뒤 `mapPolicyNewsFields`·`POLICY_NEWS_ITEM_TAG`·날짜 모양(`parsePolicyNewsDate`)·
   기간 상한을 맞춘다. 맞추기 전에는 **운영 키를 넣지 않는다** — 이름이 틀리면 항목이 전부 버려져 빈 목록이 된다
   (성공한 빈 목록으로 보인다).
5. **처리방침** — 관심 기업(사람 × 기업 고유번호)을 새로 저장한다. 처리방침의 수집 항목에 넣을지 법무 판단이 필요하다
   (`docs/legal/`, 버전 순서는 CLAUDE.md 「법무 문서 버전」).
6. **정책브리핑 저작권정책 주소 확인** — 화면의 출처 줄은 지금 공공누리 제1유형 안내(`kogl.or.kr/info/licenseType1.do`)로
   잇는다. 정책브리핑 자체의 저작권정책 쪽 주소를 확인하면 두 앱의 상수(`BriefingLinks`)를 그 주소로 바꾼다.

## 8. 앱 화면 — 더보기 → 아침 소식

### 진입과 조회

- 더보기 탭의 **'아침 소식'** 행(로그인했을 때만)에서 들어가는 하위 화면이다. 홈·알람 설정 어느 화면도 이 화면을 거치지
  않는다 — 열지 않아도 알람은 그대로 만들고 울린다(선택 기능).
- 조회는 **화면을 열 때**(관심 기업 → 오늘 소식)와 **'다시 확인' 을 누를 때**뿐이다. 주기 작업·알람 예약·⚠ **알람 울림 경로에서
  부르지 않는다**(AGENTS.md 「알람 불변 규칙」). 소식은 기기에 저장하지 않는다 — 다시 열면 다시 묻고, 서버의 15분 캐시(§4)가
  원천 부하를 맡는다.
- `Retry-After` 를 지킨다: 오늘 소식은 `errors[].retry_after_seconds` 의 최댓값(서버가 헤더에 싣는 값과 같다), 기업 검색의 503
  `BRIEFING_CORP_CODES_NOT_READY` 는 헤더(없으면 계약값 60초 — iOS 는 API 오류가 헤더를 들고 오지 않아 늘 계약값)다. 그 시각까지 '다시 확인'·'검색' 을 눌러도 요청을 보내지 않고
  "잠시 뒤에 다시 확인할 수 있어요" 를 말한다(버튼은 죽이지 않는다 — 이유를 말한다).

### 관심 기업

- '기업 추가' → 검색 알럿(입력칸 + 결과 목록). 기업명 일부나 종목코드로 찾고, 결과 행을 누르면 추가된다. 목록은
  `PUT /api/briefing/interests` 로 **통째 교체**하고, 응답의 목록으로 화면을 바꾼다(앱이 먼저 바꿔 두지 않는다).
- 상한 **3곳**(`BRIEFING_MAX_INTERESTS`). 3곳이 차 있어도 '기업 추가' 를 죽이지 않는다 — 누르면 "관심 기업은 3곳까지 고를 수
  있어요. 다른 기업을 빼고 추가해 주세요." 알럿이다. 이미 고른 기업은 결과에서 '추가됨' 으로 보이고 다시 넣지 않는다.
- 빼기는 행의 '빼기' 하나다(확인 알럿 없음 — 다시 찾으면 그만이고 데이터가 지워지지 않는다).

### 상태별 표시

화면 맨 위 한 줄이 **언제 확인했는가**와 **다 확인했는가**를 말한다: "10월 26일 오전 7:05 확인 · 모두 확인했어요" /
"… · 일부 소식을 확인하지 못했어요". 시각은 응답의 `fetched_at`(보여 주는 것 가운데 가장 오래된 확인 시각)이고, 기기 시간대로
그린다. 공시를 찾은 범위(`window`, "10월 20일~10월 26일 접수분")를 그 아래 적는다.

| 기업 상태 | 공시 있음 | 공시 없음 |
| --- | --- | --- |
| `ok` + `complete` | 공시 목록 | "이 기간에 접수된 공시가 없어요" |
| `ok` + `complete` 거짓 | 공시 목록 | "다 확인하지 못해 공시가 없다고 말할 수 없어요" — ⚠ "없어요" 라고 하지 않는다 |
| `stale` | "지금 확인하지 못해 10월 26일 오전 6:40에 확인한 내용을 보여 드려요" + 그때의 목록 | 같은 첫 줄만(그때도 없었다고 단정하지 않는다) |
| `unavailable` | — | "아직 확인하지 못했어요" + 오류 문구 |

- 기업의 오류 문구는 `errors[]` 에서 그 기업의 `corp_code` 를 가진 항목(없으면 `corp_code` 없는 `opendart` 항목)의 `code` 로
  고른다. 정책뉴스는 `source = policy_news` 항목이다.
- 정책뉴스: 오류가 없으면 목록, 비었으면 "최근 이틀 동안 올라온 정책뉴스가 없어요". 오류가 있고 받아 둔 목록이 있으면 그 목록 +
  "지금 확인하지 못해 전에 확인한 내용을 보여 드려요", 목록도 없으면 오류 문구만이다.
- 공시 한 행: 보고서명(굵게) · "10월 26일 접수" · 깃발 배지(`amended_report` → **정정본**, `corrected_later` → **정정 신고 있음**,
  `withdrawn` → **철회됨**) · '원문 보기'(DART, 외부 브라우저) · '음성 문장'. 시각을 지어 붙이지 않는다(접수일뿐이다).
- 정책뉴스 한 행: 제목 · "담당 부처 · 10월 26일 게시" · 짧은 요약(세 줄까지, **글자로만**) · '원문 보기'(korea.kr) · '음성 문장'.
- 화면 맨 아래 **출처 줄은 빼지 않는다**(§3): "공시 출처: 금융감독원 전자공시시스템(DART)", "정책뉴스 출처: 대한민국 정책브리핑
  (www.korea.kr) · 공공누리 제1유형(출처표시)" + 그 안내 링크, "주가·투자 판단은 제공하지 않아요. 자세한 내용은 원문에서 확인해 주세요."
- 이미지·썸네일은 그리지 않는다(원천이 주지도 않는다).

### 문구 표

| 코드 | 어디서 | 문구 |
| --- | --- | --- |
| `BRIEFING_SOURCE_NOT_CONFIGURED` | `errors[]` | "이 소식은 아직 준비 중이에요." |
| `BRIEFING_SOURCE_RATE_LIMITED` | `errors[]` | "확인 요청이 많아 잠시 쉬고 있어요. 잠시 뒤에 다시 확인해 주세요." |
| `BRIEFING_SOURCE_MAINTENANCE` | `errors[]` | "출처가 점검 중이라 확인하지 못했어요." |
| `BRIEFING_SOURCE_KEY_INVALID` · `BRIEFING_SOURCE_FAILED` · 모르는 값 | `errors[]` | "출처에서 소식을 받지 못했어요. 잠시 뒤에 다시 확인해 주세요." (키 오류는 우리 설정 문제라 사용자에게 갈래를 보이지 않는다) |
| `BRIEFING_NOT_CONFIGURED` (503) | 화면 전체 | "아침 소식은 아직 준비 중이에요." — 관심 기업 칸도 그리지 않는다 |
| `BRIEFING_CORP_CODES_NOT_READY` (503) | 검색 | "기업 목록을 준비하고 있어요. 잠시 뒤에 다시 찾아 주세요." |
| `BRIEFING_INVALID_QUERY` (400) | 검색 | "기업 이름이나 종목코드를 30자 안으로 입력해 주세요." |
| `BRIEFING_INVALID_INTERESTS` (400) | 저장 | "관심 기업은 3곳까지 고를 수 있어요." |
| `BRIEFING_CORP_NOT_FOUND` (400) | 저장 | "찾을 수 없는 기업이 있어요. 다시 검색해 주세요." |

HTTP 코드 다섯은 두 앱의 공용 표(`ApiErrorMessages.kt` / `APIErrorMessages.swift`)에, `errors[].code` 넷은 화면의 표
(`BriefingPresentation`)에 둔다 — 같은 실패가 두 앱에서 같은 말이다.

### 요청형 음성 — 이번에는 **문장 미리보기와 만들기·듣기까지**

- 항목의 '음성 문장' → 알럿이 **최종 문장**(§6 과 같은 규칙, 앱이 같은 함수를 갖는다 — `BriefingSpeech`)과 글자 수, 목소리 고르기,
  **차감 안내**("음성을 받을 때마다 이번 달 직접 입력 횟수를 1회 써요. 같은 문장·같은 목소리로 이미 만든 음성도 다시 받으면 1회를
  써요." + 남은 횟수)를 함께 보여 준다. 확인 없이 만들지 않는다. 이 화면은 받은 음성을 기기에 두지 않아 '만들기' 가 언제나 서버를
  부른다 — 같은 요청의 재시도가 아니면 누를 때마다 1회다(2026-10-27, voice-and-message §8).
- '확인한 날' 은 **그 항목의 `fetched_at`**(이 내용으로 처음 받아 둔 시각)의 한국 날짜다. 다시 확인만 해서 확인 시각이 바뀌어도
  문장(=서버 캐시 키)은 바뀌지 않는다 — 내용이 같으면 서버가 같은 결과를 다시 준다(합성은 없지만 1회는 센다, voice-and-message §8).
- '음성 만들기' 는 **직접 입력과 같은 경로**다: `POST /tts/generate`(`category: custom`, `language: ko`, `random: false`, 그 문장),
  같은 입력(목소리·언어·문장)은 같은 `request_id`. 차감·광고 보상·429 는 서버의 직접 입력 장부가 그대로 정한다 — 새 차감 경로가
  없다. 429 `MANUAL_TTS_QUOTA_EXCEEDED` 는 직접 입력과 같은 문구다(이 화면은 광고 게이트를 열지 않는다 — 후속).
- 목소리: 기본 목소리 4종은 누구나, **등록(클론) 목소리는 플러스일 때만** 목록에 뜬다 — 이 화면이 클론을 무료로 쓰는 우회로가
  되지 않는다(서버도 같은 규칙으로 막는다). 처음 고른 값은 마지막에 쓴 목소리(쓸 수 있을 때), 아니면 미나다.
- 만든 음성은 그 자리에서 한 번 들려준다(알람과 같은 스트림). 기기에 따로 저장하거나 알람에 붙이지 않는다.
- 문장에 "최신"·"새로운"·전망·평가·매수/매도를 넣지 않는다(§6). 확인한 **날짜**를 말한다.

### 후속(이번에 하지 않는다)

- **날짜 1회 알람으로 쓰기** — 날짜 알람(PR #955)이 들어온 뒤, 그 날짜 1회 예약에만 붙인다. 반복(weekly) 알람에 최신 정보처럼
  잇지 않는다.
- '저장한 소식 음성' 목록(만든 날짜·출처 id·기준 스냅샷을 함께 보관하고 다시 틀 때 그 날짜를 보인다).
- 429 뒤 광고 보고 한 번 더(편집기의 `AdRewardGate` 를 이 화면에도).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 요청·응답 계약, 관심 최대 3 | `network/BriefingApi.kt` · `ui/briefing/BriefingPresentation.kt` 의 `BriefingInterestRules` · 회귀 `BriefingPresentationTest` | `BriefingModels.swift` · `BriefingPresentation.swift` 의 `BriefingInterestRules` · 회귀 `BriefingPresentationTests` | `packages/shared/src/schemas/briefing.ts` · 회귀 `packages/shared/test/briefing.test.ts` |
| ZIP 풀기(중앙 디렉터리·deflate-raw·크기 상한) | — | — | `lib/briefing/zip.ts` · 회귀 `test/briefing-sources.test.ts` |
| 고유번호 읽기·상태 코드·공시 검색(쪽 넘기기·남의 행 버림·날짜만·비고 깃발) | — | — | `lib/briefing/opendart.ts` · `test/briefing-sources.test.ts` |
| 정책뉴스 읽기(필드 이름 한 곳·HTML → 글자·이미지 없음·korea.kr 만·D 삭제) | — | — | `lib/briefing/policy-news.ts` 의 `mapPolicyNewsFields` · `lib/briefing/xml.ts` · `test/briefing-sources.test.ts` |
| 원천 실패 다섯 갈래 → 코드, 한도 대기 15분 | — | — | `lib/briefing/source-error.ts` |
| 상장사만 · 잠금 · 행 수 안전장치 · 06시 크론 · 30일 지우기 | — | — | `lib/briefing/store.ts` 의 `refreshCorpCodes`·`runBriefingCron`·`pruneBriefingCache` ← `src/index.ts` `scheduled` · `test/briefing-route.test.ts` |
| 15분 캐시 · 날짜 바뀜 · stale/unavailable · complete · Retry-After | 상태별 표시 `BriefingPresentation.view`·`companyNote`·`newsSection` · Retry-After `BriefingScreen` 의 `loadToday`·`briefingRetryAfterSeconds` · 회귀 `BriefingPresentationTest` | `BriefingPresentation.model`·`companyNote`·`newsSection` · `BriefingView` 의 `loadToday` · 회귀 `BriefingPresentationTests` | `lib/briefing/store.ts` 의 `buildBriefingToday` · `test/briefing-route.test.ts` |
| LIKE 이스케이프 · limit 1~20 · 관심 통째 교체 · IDOR | — | — | `routes/briefing.ts` · `lib/briefing/store.ts` 의 `escapeLike`·`searchCorpCodes`·`replaceInterests` · `test/briefing-route.test.ts` |
| 낭독 문단 200자 | `ui/briefing/BriefingSpeech.kt` · 회귀 `BriefingSpeechTest` | `BriefingSpeech.swift` · 회귀 `BriefingPresentationTests` | `lib/briefing/speech.ts` 의 `composeBriefingSpeech` · `test/briefing-sources.test.ts` |
| 표(#137) · 탈퇴 파기 | — | — | `lib/migrations.ts` #137 · `lib/account-deletion.ts` 의 `briefing_interests` 삭제 · `test/account-purge-residue.test.ts` |
| 오류 코드 → 문구(HTTP 다섯 · `errors[].code` 넷) | `network/ApiErrorMessages.kt` 「아침 소식」 · `BriefingPresentation.sourceErrorMessageRes` | `APIErrorMessages.swift` 「아침 소식」 · `BriefingPresentation.sourceErrorMessage` | `packages/shared/src/schemas/error-codes.ts` 「아침 소식」 묶음 |
| §8 진입(더보기 · 로그인 때만) · 열 때만 조회 · 출처 줄 | `ui/home/HomeComponents.kt` 의 `MenuTabPanel` → `AppRoute.Briefing` → `ui/briefing/BriefingScreen.kt` | `MenuView` → `MainTabsView` 의 `briefingPresented` → `Views/Settings/BriefingView.swift` | — |
| §8 소식 음성 — 직접 입력과 같은 요청·`request_id`·차감 안내, 무료는 기본 목소리만 | `ui/main/MainViewModelBriefingActions.kt` 의 `generateBriefingSpeech` → `generateTtsAudio`(무료 기본 목소리 직접 입력 `isFreeSystemManualRequest` · 회귀 `TtsGenerateGateTest`) · `BriefingVoiceRules` | `BriefingView.swift` 의 `BriefingSpeechSheet` · `BriefingRequestIDs` · `BriefingVoiceRules` | `routes/tts.ts`(직접 입력 장부) |
