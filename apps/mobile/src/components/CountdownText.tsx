import React, { useState, useEffect } from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Alarm } from '../types';
import { getNextFireMs, formatCountdown } from '../lib/alarmCountdown';

interface Props {
  alarm: Alarm;
  style?: TextStyle;
}

function CountdownTextInner({ alarm, style }: Props) {
  const [, setTick] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!alarm.is_active) return null;
  const ms = getNextFireMs(alarm);
  if (ms === null) return null;

  return <Text style={style}>{formatCountdown(ms, t)}</Text>;
}

export const CountdownText = React.memo(CountdownTextInner);
