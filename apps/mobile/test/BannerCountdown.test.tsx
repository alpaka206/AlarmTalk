import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key}:${JSON.stringify(opts)}`;
      return key;
    },
  }),
}));

jest.mock('../src/lib/alarmCountdown', () => ({
  getNearestFireMs: jest.fn(),
  formatCountdown: jest.fn(),
}));

import { BannerCountdown } from '../src/components/BannerCountdown';
import { getNearestFireMs, formatCountdown } from '../src/lib/alarmCountdown';
import type { Alarm } from '../src/types';

const mockedGetNearestFireMs = getNearestFireMs as jest.MockedFunction<typeof getNearestFireMs>;
const mockedFormatCountdown = formatCountdown as jest.MockedFunction<typeof formatCountdown>;

const makeAlarm = (overrides: Partial<Alarm> = {}): Alarm => ({
  id: 'a1',
  user_id: 'u1',
  target_user_id: null,
  message_id: 'm1',
  time: '07:00',
  repeat_days: [],
  is_active: true,
  snooze_minutes: 5,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const bannerStyle = { padding: 10 };
const labelStyle = { fontSize: 12 };
const valueStyle = { fontSize: 16 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BannerCountdown', () => {
  it('알람이 없으면 null을 렌더한다', () => {
    mockedGetNearestFireMs.mockReturnValue(null);
    const { toJSON } = render(
      <BannerCountdown alarms={[]} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('가장 가까운 알람이 없으면 null을 렌더한다', () => {
    mockedGetNearestFireMs.mockReturnValue(null);
    const alarms = [makeAlarm({ is_active: false })];
    const { toJSON } = render(
      <BannerCountdown alarms={alarms} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('다음 알람까지의 카운트다운을 표시한다', () => {
    mockedGetNearestFireMs.mockReturnValue(3600000);
    mockedFormatCountdown.mockReturnValue('1시간 0분');
    const alarms = [makeAlarm()];
    render(
      <BannerCountdown alarms={alarms} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    expect(screen.getByText('alarms.nextIn')).toBeTruthy();
    expect(screen.getByText('1시간 0분')).toBeTruthy();
  });

  it('getNearestFireMs에 alarms 배열을 전달한다', () => {
    mockedGetNearestFireMs.mockReturnValue(null);
    const alarms = [makeAlarm(), makeAlarm({ id: 'a2' })];
    render(
      <BannerCountdown alarms={alarms} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    expect(mockedGetNearestFireMs).toHaveBeenCalledWith(alarms);
  });

  it('formatCountdown에 밀리초와 t 함수를 전달한다', () => {
    mockedGetNearestFireMs.mockReturnValue(7200000);
    mockedFormatCountdown.mockReturnValue('2시간 0분');
    render(
      <BannerCountdown alarms={[makeAlarm()]} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    expect(mockedFormatCountdown).toHaveBeenCalledWith(7200000, expect.any(Function));
  });

  it('bannerStyle이 View에 적용된다', () => {
    mockedGetNearestFireMs.mockReturnValue(1000);
    mockedFormatCountdown.mockReturnValue('0분');
    const { toJSON } = render(
      <BannerCountdown alarms={[makeAlarm()]} bannerStyle={bannerStyle} labelStyle={labelStyle} valueStyle={valueStyle} />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('"padding":10');
  });

  it('React.memo로 래핑되어 있다', () => {
    expect(BannerCountdown).toHaveProperty('$$typeof');
    expect((BannerCountdown as unknown as { type: unknown }).type).toBeDefined();
  });
});
