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
  getNextFireMs: jest.fn(),
  formatCountdown: jest.fn(),
}));

import { CountdownText } from '../src/components/CountdownText';
import { getNextFireMs, formatCountdown } from '../src/lib/alarmCountdown';
import type { Alarm } from '../src/types';

const mockedGetNextFireMs = getNextFireMs as jest.MockedFunction<typeof getNextFireMs>;
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CountdownText', () => {
  it('비활성 알람이면 null을 렌더한다', () => {
    const alarm = makeAlarm({ is_active: false });
    const { toJSON } = render(<CountdownText alarm={alarm} />);
    expect(toJSON()).toBeNull();
    expect(mockedGetNextFireMs).not.toHaveBeenCalled();
  });

  it('getNextFireMs가 null을 반환하면 null을 렌더한다', () => {
    mockedGetNextFireMs.mockReturnValue(null);
    const alarm = makeAlarm();
    const { toJSON } = render(<CountdownText alarm={alarm} />);
    expect(toJSON()).toBeNull();
  });

  it('카운트다운 텍스트를 표시한다', () => {
    mockedGetNextFireMs.mockReturnValue(5400000);
    mockedFormatCountdown.mockReturnValue('1시간 30분');
    const alarm = makeAlarm();
    render(<CountdownText alarm={alarm} />);
    expect(screen.getByText('1시간 30분')).toBeTruthy();
  });

  it('getNextFireMs에 alarm 객체를 전달한다', () => {
    mockedGetNextFireMs.mockReturnValue(null);
    const alarm = makeAlarm({ time: '14:30' });
    render(<CountdownText alarm={alarm} />);
    expect(mockedGetNextFireMs).toHaveBeenCalledWith(alarm);
  });

  it('formatCountdown에 밀리초와 t를 전달한다', () => {
    mockedGetNextFireMs.mockReturnValue(3600000);
    mockedFormatCountdown.mockReturnValue('1시간 0분');
    render(<CountdownText alarm={makeAlarm()} />);
    expect(mockedFormatCountdown).toHaveBeenCalledWith(3600000, expect.any(Function));
  });

  it('style prop이 Text에 적용된다', () => {
    mockedGetNextFireMs.mockReturnValue(1000);
    mockedFormatCountdown.mockReturnValue('0분');
    const style = { fontSize: 20, color: 'red' };
    const { toJSON } = render(<CountdownText alarm={makeAlarm()} style={style} />);
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('"fontSize":20');
    expect(tree).toContain('"color":"red"');
  });

  it('style이 없어도 정상 렌더한다', () => {
    mockedGetNextFireMs.mockReturnValue(1000);
    mockedFormatCountdown.mockReturnValue('0분');
    render(<CountdownText alarm={makeAlarm()} />);
    expect(screen.getByText('0분')).toBeTruthy();
  });

  it('React.memo로 래핑되어 있다', () => {
    expect(CountdownText).toHaveProperty('$$typeof');
    expect((CountdownText as unknown as { type: unknown }).type).toBeDefined();
  });
});
