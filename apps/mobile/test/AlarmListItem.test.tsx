import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('../src/components/CountdownText', () => {
  const { Text } = require('react-native');
  return {
    CountdownText: ({ alarm }: { alarm: { time: string } }) => (
      <Text testID="countdown">countdown-{alarm.time}</Text>
    ),
  };
});

jest.mock('../src/i18n', () => ({
  getDateLocale: () => 'ko-KR',
}));

import { AlarmListItem } from '../src/components/AlarmListItem';
import { createAlarmsStyles } from '../src/styles/alarmsStyles';
import type { Alarm } from '../src/types';

const { Colors } = jest.requireActual('../src/constants/theme') as typeof import('../src/constants/theme');
const styles = createAlarmsStyles(Colors.light);
const colors = Colors.light;

const t = ((key: string, opts?: Record<string, string>) => {
  if (opts && 'name' in opts) return `${key}:${opts['name']}`;
  return key;
}) as unknown as import('i18next').TFunction;

const formatRepeatDays = (days: number[]) =>
  days.length === 0 ? '한 번' : days.join(',');

const makeAlarm = (overrides: Partial<Alarm> = {}): Alarm => ({
  id: 'a1',
  user_id: 'u1',
  target_user_id: null,
  message_id: 'm1',
  time: '07:30',
  repeat_days: [1, 2, 3, 4, 5],
  is_active: true,
  snooze_minutes: 5,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  mode: 'tts',
  voice_name: '엄마',
  message_text: '좋은 아침!',
  ...overrides,
});

const renderDeleteAction = () => null;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AlarmListItem', () => {
  it('알람 시간을 표시한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ time: '08:15' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('08:15')).toBeTruthy();
  });

  it('음성 이름을 표시한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ voice_name: '아빠' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText(/아빠/)).toBeTruthy();
  });

  it('메시지 텍스트를 표시한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ message_text: '파이팅!' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText(/파이팅!/)).toBeTruthy();
  });

  it('반복 요일을 formatRepeatDays로 렌더링한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ repeat_days: [1, 3, 5] })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('1,3,5')).toBeTruthy();
  });

  it('활성 알람에 CountdownText를 렌더링한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ is_active: true, time: '07:30' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByTestId('countdown')).toBeTruthy();
  });

  it('비활성 알람에는 CountdownText를 렌더링하지 않는다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ is_active: false })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.queryByTestId('countdown')).toBeNull();
  });

  it('TTS 모드 뱃지를 표시한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ mode: 'tts' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText(/alarmPlayback.modeTts/)).toBeTruthy();
  });

  it('sound-only 모드 뱃지를 표시한다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ mode: 'sound-only' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText(/alarmPlayback.modeOriginal/)).toBeTruthy();
  });

  it('카드 탭 시 onPress에 alarm을 전달한다', () => {
    const onPress = jest.fn();
    const alarm = makeAlarm({ id: 'a-press' });
    render(
      <AlarmListItem
        item={alarm}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={onPress}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    fireEvent.press(screen.getByRole('button', { name: /alarms.title/ }));
    expect(onPress).toHaveBeenCalledWith(alarm);
  });

  it('카드 롱프레스 시 onDelete에 id를 전달한다', () => {
    const onDelete = jest.fn();
    render(
      <AlarmListItem
        item={makeAlarm({ id: 'a-del' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={onDelete}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    fireEvent(screen.getByRole('button', { name: /alarms.title/ }), 'longPress');
    expect(onDelete).toHaveBeenCalledWith('a-del');
  });

  it('미리듣기 버튼 탭 시 onPreview에 alarm을 전달한다', () => {
    const onPreview = jest.fn();
    const alarm = makeAlarm();
    render(
      <AlarmListItem
        item={alarm}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={onPreview}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const previewBtns = screen.getAllByRole('button', { name: 'alarms.a11yPreview' });
    fireEvent(previewBtns[previewBtns.length - 1]!, 'press', { stopPropagation: jest.fn() });
    expect(onPreview).toHaveBeenCalledWith(alarm);
  });

  it('토글 시 onToggle에 id와 값을 전달한다', () => {
    const onToggle = jest.fn();
    render(
      <AlarmListItem
        item={makeAlarm({ id: 'a-toggle', is_active: true })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={onToggle}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    fireEvent(screen.getByRole('switch'), 'valueChange', false);
    expect(onToggle).toHaveBeenCalledWith('a-toggle', false);
  });

  it('가족 알람 뱃지를 표시한다 (수신된 가족 알람)', () => {
    render(
      <AlarmListItem
        item={makeAlarm({
          is_received_family_alarm: true,
          sender_name: '엄마',
        })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText(/familyAlarmLabel.receivedAlarm/)).toBeTruthy();
  });

  it('일반 알람에는 가족 뱃지를 표시하지 않는다', () => {
    const { toJSON } = render(
      <AlarmListItem
        item={makeAlarm({ is_family_alarm: false })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toContain('familyAlarmLabel.receivedAlarm');
  });

  it('접근성: 카드에 알람 시간과 음성 이름이 포함된 라벨이 있다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ time: '06:00', voice_name: 'Dad' })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByRole('button', { name: /06:00/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Dad/ })).toBeTruthy();
  });

  it('접근성: Switch에 toggleAlarm 라벨과 checked 상태가 있다', () => {
    render(
      <AlarmListItem
        item={makeAlarm({ is_active: true })}
        styles={styles}
        colors={colors}
        userId="u1"
        t={t}
        formatRepeatDays={formatRepeatDays}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onPreview={jest.fn()}
        onToggle={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const switchEl = screen.getByRole('switch');
    expect(switchEl.props.accessibilityLabel).toBe('alarms.toggleAlarm');
    expect(switchEl.props.accessibilityState).toEqual({ checked: true });
  });

  it('React.memo로 래핑되어 있다', () => {
    expect(AlarmListItem).toHaveProperty('$$typeof');
    expect((AlarmListItem as unknown as { type: unknown }).type).toBeDefined();
  });
});
