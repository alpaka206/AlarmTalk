/**
 * 앱 지역 시트의 **날씨 출처 줄**을 켜는 신호 — `GET /api/app/version` 의 `weather_attribution`.
 *
 * 두 앱은 이 값이 **정확히** `'kma_jma_nws'` 일 때만 지역 시트 목록 아래에 "날씨 정보: 기상청 · 気象庁 ·
 * 미국 기상청(NWS)의 예보를 바탕으로 AlarmTalk가 가공" 을 보인다. 그 밖 — `null`·모르는 값·필드가 없는 옛 서버·
 * 버전 확인 실패 — 은 숨긴다. 출처 문장이 **이 서버가 실제로 쓰는 원천**을 따라가게 하려는 것이다. 앱이 문장을
 * 스스로 단정하면 원천 교체가 늦거나 되돌려진 동안 쓰지 않는 기관을 출처로 적는다 — 출처 표기(기상법 제12조의3 ⑤,
 * 気象庁 공공데이터 이용규약)의 목적이 거꾸로 된다(코덱스 #845).
 * 규칙: `docs/spec/voice-and-message.md` 「지역 시트의 날씨 출처 줄 — 서버가 원천을 말할 때만」.
 *
 * ⚠ **값은 불투명 토큰이다.** 원천 조합이 바뀌면 새 토큰을 만들고 두 앱에 그 문장을 더한다 — 옛 앱은 모르는
 * 토큰을 숨기므로 틀린 문장을 말하지 않는다. 이미 나간 토큰의 뜻을 바꾸지 말 것.
 */
export type WeatherAttribution = 'kma_jma_nws';

/**
 * 지금은 **`null`** 이다 — 이 서버는 아직 Open-Meteo 로 날씨를 받는다(`lib/weather-region-daily.ts`·
 * `lib/weather-signal.ts`). 원천을 나라별 공식 예보(기상청·気象庁·NWS)로 바꾸는 변경이 **그 변경 안에서**
 * `'kma_jma_nws'` 로 올린다 — 그래야 배포·롤백이 원천과 출처 표기를 함께 옮긴다.
 * 회귀: `test/app-version.test.ts`(응답에 실리는 값 · Open-Meteo 를 부르는 동안은 `null`).
 */
export const WEATHER_ATTRIBUTION: WeatherAttribution | null = null;
