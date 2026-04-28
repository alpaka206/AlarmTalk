import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Alarm } from '../types';
import { getNearestFireMs, formatCountdown } from '../lib/alarmCountdown';

interface Props {
  alarms: Alarm[];
  bannerStyle: object;
  labelStyle: object;
  valueStyle: object;
}

function BannerCountdownInner({ alarms, bannerStyle, labelStyle, valueStyle }: Props) {
  const [, setTick] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nearest = getNearestFireMs(alarms);
  if (nearest === null) return null;

  return (
    <View style={bannerStyle}>
      <Text style={labelStyle}>{t('alarms.nextIn')}</Text>
      <Text style={valueStyle}>{formatCountdown(nearest, t)}</Text>
    </View>
  );
}

export const BannerCountdown = React.memo(BannerCountdownInner);
