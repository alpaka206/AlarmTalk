import { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

const ITEM_HEIGHT = 56;
const VISIBLE_ROWS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const PADDING_ROWS = Math.floor(VISIBLE_ROWS / 2);

// Repeat the small set of labels enough times that 12→1 / 59→00 flow naturally
// without hitting a scroll bound, but small enough that the total view count
// stays well below Fabric's mount-item budget. 30 rounds gives 360 hour items
// and 1,800 minute items — plenty in practice (you'd need to swipe 30 full
// 12-hour rounds to reach the edge) and well under the OOM threshold.
const REPEAT = 30;
const HOUR_PERIOD = 12;
const MINUTE_PERIOD = 60;
const HOUR_BASE = HOUR_PERIOD * Math.floor(REPEAT / 2); // ≈ 1200
const MINUTE_BASE = MINUTE_PERIOD * Math.floor(REPEAT / 2); // ≈ 6000

const HOUR_LABELS = Array.from({ length: HOUR_PERIOD }, (_, i) => String(i + 1));
const MINUTE_LABELS = Array.from({ length: MINUTE_PERIOD }, (_, i) =>
  String(i).padStart(2, '0'),
);

const HOUR_ITEMS = Array.from(
  { length: HOUR_PERIOD * REPEAT },
  (_, i) => HOUR_LABELS[i % HOUR_PERIOD]!,
);
const MINUTE_ITEMS = Array.from(
  { length: MINUTE_PERIOD * REPEAT },
  (_, i) => MINUTE_LABELS[i % MINUTE_PERIOD]!,
);
const AMPM_LABELS = ['오전', '오후'];

type Props = {
  /** 0–23 */
  hour: number;
  /** 0–59 */
  minute: number;
  onChange: (hour24: number, minute: number) => void;
};

export function WheelTimePicker({ hour, minute, onChange }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const isPM = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  // Absolute hour/minute index inside the repeated list.
  const hourIdx = HOUR_BASE + (hour12 - 1);
  const minuteIdx = MINUTE_BASE + minute;

  // Track previous absolute index to detect a "round" wrap (12 → 1, 59 → 00).
  const lastHourIdx = useRef(hourIdx);
  const lastMinuteIdx = useRef(minuteIdx);

  useEffect(() => {
    lastHourIdx.current = hourIdx;
    lastMinuteIdx.current = minuteIdx;
  }, [hourIdx, minuteIdx]);

  const handleHourSelect = (newIdx: number) => {
    const prevIdx = lastHourIdx.current;
    if (newIdx === prevIdx) return;
    lastHourIdx.current = newIdx;

    const newHour12 = (newIdx % HOUR_PERIOD) + 1;
    const prevRound = Math.floor(prevIdx / HOUR_PERIOD);
    const newRound = Math.floor(newIdx / HOUR_PERIOD);
    const roundDiff = newRound - prevRound;
    // Each completed round (12-hour wrap) flips AM/PM.
    const nextIsPM = roundDiff % 2 === 0 ? isPM : !isPM;

    const nextHour24 = (newHour12 % 12) + (nextIsPM ? 12 : 0);
    onChange(nextHour24, minute);
  };

  const handleMinuteSelect = (newIdx: number) => {
    const prevIdx = lastMinuteIdx.current;
    if (newIdx === prevIdx) return;
    lastMinuteIdx.current = newIdx;

    const newMinute = newIdx % MINUTE_PERIOD;
    const prevRound = Math.floor(prevIdx / MINUTE_PERIOD);
    const newRound = Math.floor(newIdx / MINUTE_PERIOD);
    const hourDelta = newRound - prevRound;
    const nextHour24 = (((hour + hourDelta) % 24) + 24) % 24;

    onChange(nextHour24, newMinute);
  };

  const handleAmPmSelect = (idx: number) => {
    const nextIsPM = idx === 1;
    if (nextIsPM === isPM) return;
    const nextHour24 = (hour12 % 12) + (nextIsPM ? 12 : 0);
    onChange(nextHour24, minute);
  };

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.highlightOverlay} />
      <View style={styles.row}>
        <Column
          items={AMPM_LABELS}
          selectedIndex={isPM ? 1 : 0}
          onSelect={handleAmPmSelect}
          width={88}
          styles={styles}
          loop={false}
        />
        <Column
          items={HOUR_ITEMS}
          selectedIndex={hourIdx}
          onSelect={handleHourSelect}
          width={72}
          align="right"
          styles={styles}
          loop
        />
        <Text style={styles.separator}>:</Text>
        <Column
          items={MINUTE_ITEMS}
          selectedIndex={minuteIdx}
          onSelect={handleMinuteSelect}
          width={72}
          align="left"
          styles={styles}
          loop
        />
      </View>
    </View>
  );
}

type ColumnProps = {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  width: number;
  align?: 'left' | 'center' | 'right';
  styles: ReturnType<typeof createStyles>;
  loop: boolean;
};

function Column({
  items,
  selectedIndex,
  onSelect,
  width,
  align = 'center',
  styles,
  loop,
}: ColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lastReportedIndex = useRef(selectedIndex);
  const isUserScrolling = useRef(false);

  // Sync scroll position when parent changes selectedIndex (and user isn't dragging).
  useEffect(() => {
    if (selectedIndex === lastReportedIndex.current) return;
    if (isUserScrolling.current) return;
    lastReportedIndex.current = selectedIndex;
    scrollRef.current?.scrollTo({
      y: selectedIndex * ITEM_HEIGHT,
      animated: false,
    });
  }, [selectedIndex]);

  // Initial centering on mount.
  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: selectedIndex * ITEM_HEIGHT,
        animated: false,
      });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isUserScrolling.current = false;
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    if (clamped !== lastReportedIndex.current) {
      lastReportedIndex.current = clamped;
      onSelect(clamped);
    }
  };

  // Short non-loop columns (e.g. AM/PM with only two options) don't need a
  // wheel — scrolling there is meaningless and the overscroll bubbles up to
  // the parent ScrollView, making the whole screen jiggle. Render those as
  // a tap-only stack; long loop columns keep the wheel behavior.
  const isStaticList = !loop && items.length <= VISIBLE_ROWS;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ height: PICKER_HEIGHT, width }}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * PADDING_ROWS }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      snapToAlignment="start"
      decelerationRate={Platform.OS === 'android' ? 0.985 : 'fast'}
      onScrollBeginDrag={() => {
        isUserScrolling.current = true;
      }}
      onMomentumScrollEnd={handleEnd}
      onScrollEndDrag={handleEnd}
      scrollEnabled={!isStaticList}
      bounces={false}
      overScrollMode="never"
      nestedScrollEnabled
      removeClippedSubviews={false}
    >
      {items.map((label, idx) => {
        const isSelected = idx === selectedIndex;
        const distance = Math.abs(idx - selectedIndex);
        const opacity =
          distance === 0 ? 1 : distance === 1 ? 0.55 : distance === 2 ? 0.25 : 0.12;
        const content = (
          <Text
            style={[
              styles.itemText,
              isSelected ? styles.itemTextSelected : null,
              {
                opacity,
                textAlign: align,
                width: '100%',
              },
            ]}
          >
            {label}
          </Text>
        );
        if (isStaticList) {
          return (
            <Pressable
              key={`${label}-${idx}`}
              style={styles.item}
              onPress={() => onSelect(idx)}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              {content}
            </Pressable>
          );
        }
        return (
          <View key={`${label}-${idx}`} style={styles.item}>
            {content}
          </View>
        );
      })}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors, _isDark: boolean) {
  // Use the warm-charcoal / warm-cream text token so the selected row matches
  // the rest of the typography in the new mustard+navy palette.
  const selectedColor = colors.text;
  return StyleSheet.create({
    container: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    highlightOverlay: {
      position: 'absolute',
      top: ITEM_HEIGHT * PADDING_ROWS + 8,
      height: ITEM_HEIGHT,
      left: 0,
      right: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    item: {
      height: ITEM_HEIGHT,
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemText: {
      fontSize: 32,
      fontFamily: FontFamily.regular,
      color: colors.text,
    },
    itemTextSelected: {
      fontSize: 40,
      fontFamily: FontFamily.bold,
      color: selectedColor,
    },
    separator: {
      fontSize: 36,
      fontFamily: FontFamily.bold,
      color: selectedColor,
      marginHorizontal: 8,
    },
  });
}
