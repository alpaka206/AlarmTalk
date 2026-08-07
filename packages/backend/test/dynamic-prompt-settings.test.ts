import { describe, expect, it } from 'vitest';
import {
  dynamicPromptSettingsState,
  validateDynamicPromptSettings,
} from '../src/lib/dynamic-prompt-settings';
import {
  FORTUNE_BIRTH_TIME_CHOICES,
  FORTUNE_BIRTH_TIME_UNKNOWN,
} from '@alarmtalk/shared';

describe('dynamicPromptSettingsState', () => {
  it('marks weather ready when only city is stored', () => {
    const settings = {
      weather: { country: null, city: 'Paris' },
      fortune: { gender: null, birth_date: null, birth_time: null },
    };

    const state = dynamicPromptSettingsState(settings);

    expect(state.weather_ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 태어난 시간 형식 — 세 구현이 갈라져 있던 자리
//
// ⚠ 예전에는 여기에 `HH:MM` 정규식이 박혀 있었고, 안드로이드는 사주 시진을 **구간**
// (`"00:00~01:30"`)으로 보냈다. 그래서 **13개 선택지가 전부 400** 이었다. 게다가
// `PATCH /user/me` 는 운세와 날씨를 한 payload 로 받으므로, 태어난 시간을 고른 순간
// **날씨 지역까지 함께 저장에 실패**했다 — 실패는 조용히 삼켜져 사용자는 저장된 줄 알았다.
// ---------------------------------------------------------------------------
describe('태어난 시간 형식', () => {
  const base = {
    weather: { city: '서울' },
    fortune: { gender: '여성', birth_date: '1990-01-01' },
  };
  const accept = (birth_time: string) =>
    validateDynamicPromptSettings({ ...base, fortune: { ...base.fortune, birth_time } });

  // 안드로이드 `FortuneBirthTimeChoices` 13종 — shared 의 FORTUNE_BIRTH_TIME_CHOICES 와 같다.
  it.each(FORTUNE_BIRTH_TIME_CHOICES)('시진 구간 "%s" 을 받는다', (choice) => {
    expect(accept(choice)).not.toBeNull();
  });

  // '모른다' 는 정당한 답이다 — 실제로 모르는 사람이 많다. 빈 값('아직 안 골랐다')과 다르다.
  it('"시간 모름" 을 받는다', () => {
    expect(accept(FORTUNE_BIRTH_TIME_UNKNOWN)).not.toBeNull();
  });

  // 옛 클라이언트가 보낸 단일 시각도 계속 받는다(기존 행이 400 을 맞으면 안 된다).
  it('HH:MM 단일 시각도 계속 받는다', () => {
    expect(accept('07:30')).not.toBeNull();
  });

  it('말이 안 되는 값은 거절한다', () => {
    expect(accept('25:00')).toBeNull();
    expect(accept('아무거나')).toBeNull();
    expect(accept('07:30~99:99')).toBeNull();
  });

  // 날씨와 운세가 한 payload 라, 운세가 거절되면 날씨도 함께 날아간다.
  // 그게 이 버그의 실제 피해 범위였다.
  it('운세가 거절되면 같은 요청의 날씨 지역도 저장되지 않는다', () => {
    expect(accept('아무거나')).toBeNull();
    expect(accept('09:31~11:30')?.weather.city).toBe('서울');
  });
});
