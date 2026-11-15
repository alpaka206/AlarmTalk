# 알람 문구 오프라인 평가 도구

알람 문구 생성·선택 품질을 **제공자끼리 나란히 놓고 보는** 평가 도구다(오너 v1.3 계획 W15).
운영 모델과 요청 경로는 그대로 두며, 이 폴더의 코드는 백엔드 라우트·크론에서 부르지 않는다.
패키지 진입점(`src/index.ts`)에서도 내보내지 않는다.

- 운영 Gemini 경로를 실호출해 재는 도구는 따로 있다: `packages/backend/scripts/eval-gemini-prompts.ts`
  (`npm run eval:gemini`, Vertex 자격 증명 필요). 이 도구는 **네트워크 없이** 같은 눈금으로 여러 제공자의 출력을
  견주는 쪽이다. 그 스크립트의 결과를 fixture 로 옮겨 여기서 볼 수 있다.

## 실행

```sh
# 저장소 루트에서
npm run eval -- --provider current --set ko
npm run eval -- --provider jev --set all
npm run eval -- --provider current --set en --fixture path/to/outputs.json --label after-prompt-v2
```

| 인자 | 값 | 기본 |
| --- | --- | --- |
| `--provider` | `current` · `jev` · `qwen` · `chatterbox` | `current` |
| `--set` | `ko` · `en` · `ja` · `all` | `all` |
| `--fixture` | current 출력 fixture 경로 | `data/current-outputs.sample.json` |
| `--label` | 결과 폴더 이름 끝에 붙는 말 | 없음 |
| `--out` | 결과 폴더(지정하면 그대로 쓴다) | `packages/voice/.text-quality-reports/<시각>-<제공자>-<세트>[-<label>]/` |

결과는 `report.json`·`report.md` 두 개다. 출력 원문이 들어가므로 결과 폴더는 gitignore 다.

**키가 없거나 어댑터가 없는 제공자를 고르면 부르지 않는다.** 보고서 맨 위에 `실제 API 평가 미실행 — <제공자>: <이유>`
를 적고, current fixture 로 규칙 검사만 돈다. current 자체도 fixture·로컬 출력만 읽으므로 같은 문구가 붙는다 —
지금 이 도구로 나온 숫자는 전부 **실제 API 를 부르지 않은 결과**다.

## 보고서

- 문항별: id · 종류 · 언어(입력→목표) · PASS/FAIL/ERROR · 실패 규칙 · 출력 · 고른 id · 비용(USD) · 시간(ms) · 오류
- 불일치 표: 실패한 규칙마다 한 줄(id · 규칙 · 내용)
- 비용·시간은 **잰 값만** 적는다. 재지 않았으면 null(`—`)이다 — 0 으로 채우지 않는다.

## 규칙(`rules.ts`, 전부 순수 함수)

| 규칙 | 보는 것 | 근거 |
| --- | --- | --- |
| `non_empty` | 태그를 벗기고 글자·숫자가 남는가 | `prerenderRejectionReason` 의 `empty_spoken` |
| `max_length` | 낭독 기준 200자(직접 입력·생성). 프리셋은 면제(skip) | `routes/tts.ts` `TEXT_TOO_LONG`, `VoicePreviewTextUpdateSchema` |
| `no_markup` | 입력에 없던 SSML·HTML·마크다운·대괄호 태그·지문 괄호·이모지. 입력에 글자 웃음이 있으면 `[laughs]` 허용 | 사용자가 친 대괄호는 운영도 거르지 않는다(`prepareAlarmTextWithVertex`) |
| `numbers_preserved` | 입력의 숫자가 개수까지 남는가('7시 30분' → 7·30, 번역 '7:30' 도 같다) | |
| `required_phrases` | 문항이 지정한 구절이 그대로 남는가 | |
| `language` | 허용 언어로 판정되는가 + 다른 문자가 섞이지 않았는가 | 백엔드 `inferSynthesisLanguage` 사본(`language.ts`) |
| `candidate_id` | 고른 id 가 후보 안에 있는가, 후보 id 형식·중복 | |
| `recent_excluded` | 최근 N개(최신이 앞)를 고르지 않았는가. 후보가 전부 그 안이면 skip | |
| `korean_register` | 문장 끝 어체가 기대(존댓말/반말)와 맞는가, 한 줄 안에서 섞이지 않았는가 | 운영 `koreanRegisterViolation` 보다 단순한 판정 |
| `banned_promise` | 건강·운세·수익 약속 낱말 중 **입력에 없던 것** | 작은 출발 목록(`BANNED_PROMISES`) |

판정의 한계(넓히기 전에 알아 둘 것):

- **한국어 어체는 문장 끝 낱말만 본다.** 쉼표로 이은 절, 관계·청자 호칭, 명사로 끝난 마디('빨래')는 가르지 못한다.
  운영 문지기(`vertex-translate.ts` 의 `koreanRegisterViolation`)가 훨씬 정교하다 — 어긋나는 판정을 찾으면 그쪽과
  견주어 본다. 일본어 어체는 보지 않는다.
- **금지 약속은 낱말 목록이다.** 목록에 없는 표현은 못 잡고, 목록의 낱말이 정당한 문맥에 쓰이면 잘못 잡는다.
- 언어 판정은 운영과 같은 순서다 — 한글이 한 글자라도 있으면 ko. 영어 줄 속 한글 호칭은 문항의
  `allowedForeignTerms` 로 뺀다.
- `language.ts` 는 백엔드 함수의 사본이다(백엔드가 이 패키지를 쓰므로 거꾸로 부르면 의존이 돈다).
  `test/text-quality/language.test.ts` 가 백엔드 원본의 정규식 글자를 읽어 같은지 본다.

## 평가 세트(`data/cases.json`)

**출발점 세트다 — 벤치마크가 아니다.** 한국어 40·영어 10·일본어 10 문항을 2026-10-26 에 손으로 썼다. API 로 만들거나
실제 사용자 문구를 옮기지 않았다. 문항이 적어 통과율은 같은 세트 안에서 제공자를 견주는 눈금일 뿐, 품질 수치로 인용하지
않는다.

종류: `manual`(직접 입력 — 같은 언어 / 번역) · `generated`(시드·상황에서 새 한 줄) · `preset`(우리 프리셋) ·
`selection`(후보 중 고르기, `candidates`·`recent`·`recentWindow`). 기대값은 `expect`(`register` · `mustContain` ·
`preserveNumbers` · `allowedLanguages` · `allowedForeignTerms`).

## 제공자(`providers.ts`)

| id | 상태 | 설명 |
| --- | --- | --- |
| `current` | 구현 | 같은 언어 직접 입력·프리셋은 원문 그대로(운영도 Gemini 를 부르지 않는다 — 앞뒤 공백만 정리, 글자 웃음 → `[laughs]` 변환은 옮기지 않았다). 나머지는 fixture 에서 읽는다. fixture 에 없는 문항은 지어내지 않고 오류로 남긴다 |
| `jev` | 스텁 | 아래 「jev 어댑터」 |
| `qwen` | 설정만 | 호스팅 API 를 정하면 어댑터를 붙인다 |
| `chatterbox` | 설정만 | 음성 합성 모델이라 문구를 만들지 않는다. 음성 비교를 붙일 자리만 있다 |

GPU 서버를 띄우거나 모델 가중치를 받는 코드는 없다.

### current fixture

`data/current-outputs.sample.json` 은 **손으로 쓴 견본**이다(`_meta.source` 에 그렇게 적혀 있다). 러너가 끝까지 도는지
보려는 자리 채움이지 운영 출력이 아니다. 실제 비교를 하려면 운영 출력을 같은 모양으로 옮긴다:

```json
{
  "_meta": { "source": "어디서 받았는가", "capturedAt": "2026-10-26T00:00:00Z" },
  "outputs": {
    "ko-023": { "text": "It's 7:30. ...", "costUsd": null, "latencyMs": 812 },
    "ko-035": { "selectedId": "ko-weather-04" }
  }
}
```

선택 문항은 `selectedId` 만 적으면 그 후보의 글이 출력이 된다.

### jev 어댑터

TypeSafe/Jev 공식 JS SDK 의 패키지 이름·버전·라이선스·API 모양을 **확인하지 못해** 스텁으로 두었다(2026-10-26).
웹 검색에는 `@typesafe-ai/sdk` 라는 이름이 2차 자료(블로그·튜토리얼)로만 나왔고, 이 맥에서 npm 레지스트리 조회는 사내 TLS
검사(`SELF_SIGNED_CERT_IN_CHAIN`)로 막혔다. 확인하지 않은 패키지를 의존성에 넣지 않았다.

실제 어댑터로 바꾸려면 오너가 정해 줄 것:

1. 공식 패키지 이름과 고정할 버전, 라이선스(공식 문서·npm 페이지로 확인)
2. API 키 — 환경 변수 `JEV_API_KEY` 로 읽게 해 두었다(값은 출력하지 않는다). 키를 dev·prod 와 나눌지
3. 쓸 모델·엔드포인트, 요청당 비용을 응답에서 읽을 수 있는지(없으면 `costUsd` 는 null 로 남긴다)
4. 문구 원문을 외부로 보내도 되는지 — 세트는 손으로 쓴 문구라 개인 정보는 없지만, 실제 사용자 문구를 넣는 순간 처리방침 문제다

그다음 `createJevProvider` 가 `status: 'ready'` 로 서서 `generate` 에서 SDK 를 부르고 `costUsd`·`latencyMs` 를 채우면 된다.
의존성은 이 패키지의 `devDependencies` 에만 넣는다(운영 번들에 들어가지 않게).

## 사용한 서드파티

새로 넣은 의존성은 없다. Node 표준 모듈(`node:fs`·`node:path`·`node:url`)과 저장소가 이미 쓰는 TypeScript·vitest 만
쓴다. 실행은 Node 의 타입 제거(`--experimental-strip-types`, Node 24)로 한다.
