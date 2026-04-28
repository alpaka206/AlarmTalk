import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Animated } from 'react-native';

export function useToast(duration = 3000) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useMemo(() => new Animated.Value(0), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setMessage(null);
      });
    }, duration);
  }, [opacity, duration]);

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  return { message, opacity, show };
}
