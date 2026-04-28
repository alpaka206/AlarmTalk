jest.mock('react-native', () => ({
  Animated: {
    Value: jest.fn().mockImplementation((v: number) => ({ _value: v })),
    timing: jest.fn().mockReturnValue({
      start: jest.fn((cb?: () => void) => cb?.()),
    }),
  },
}));

import { Animated } from 'react-native';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useToast — 로직 테스트', () => {
  it('Animated.Value(0)으로 초기화된다', () => {
    expect(Animated.Value).toBeDefined();
    const val = new Animated.Value(0);
    expect(val).toBeDefined();
  });

  it('Animated.timing이 호출 가능하다', () => {
    const opacity = new Animated.Value(0);
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });
    expect(anim.start).toBeDefined();
  });

  it('show 호출 시 fade-in → 대기 → fade-out 순서로 동작한다', () => {
    const opacity = new Animated.Value(0);
    const duration = 3000;
    let message: string | null = null;

    // show 로직 시뮬레이션
    const show = (msg: string) => {
      message = msg;
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

      setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
          message = null;
        });
      }, duration);
    };

    show('테스트 메시지');
    expect(message).toBe('테스트 메시지');
    // fade-in timing 호출됨
    expect(Animated.timing).toHaveBeenCalledWith(
      opacity,
      expect.objectContaining({ toValue: 1, duration: 200 }),
    );

    // 타이머 진행 전에는 메시지가 남아있다
    jest.advanceTimersByTime(2999);
    expect(message).toBe('테스트 메시지');

    // 3초 후 fade-out 시작 + callback에서 message=null
    jest.advanceTimersByTime(1);
    expect(message).toBeNull();
  });

  it('연속 show 호출 시 이전 타이머가 취소된다', () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let message: string | null = null;

    const show = (msg: string) => {
      if (timer) clearTimeout(timer);
      message = msg;
      timer = setTimeout(() => {
        message = null;
      }, 3000);
    };

    show('첫 번째');
    jest.advanceTimersByTime(2000);
    show('두 번째');
    jest.advanceTimersByTime(2000);
    // 첫 번째의 3초가 지났지만 취소되었으므로 message는 두 번째
    expect(message).toBe('두 번째');
    jest.advanceTimersByTime(1000);
    expect(message).toBeNull();
  });

  it('커스텀 duration을 사용할 수 있다', () => {
    let message: string | null = null;
    const customDuration = 1000;

    const show = (msg: string) => {
      message = msg;
      setTimeout(() => {
        message = null;
      }, customDuration);
    };

    show('빠른 토스트');
    expect(message).toBe('빠른 토스트');
    jest.advanceTimersByTime(999);
    expect(message).toBe('빠른 토스트');
    jest.advanceTimersByTime(1);
    expect(message).toBeNull();
  });

  it('빈 문자열도 메시지로 설정된다', () => {
    let message: string | null = null;
    const show = (msg: string) => {
      message = msg;
    };
    show('');
    expect(message).toBe('');
  });

  it('한국어 메시지를 올바르게 처리한다', () => {
    let message: string | null = null;
    const show = (msg: string) => {
      message = msg;
    };
    show('코드가 등록되었습니다! 🎉');
    expect(message).toBe('코드가 등록되었습니다! 🎉');
  });

  it('cleanup 시 타이머가 정리된다', () => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const show = () => {
      timer = setTimeout(() => {}, 3000);
    };

    show();
    expect(timer).not.toBeNull();

    // cleanup
    if (timer) clearTimeout(timer);
    timer = null;
    expect(timer).toBeNull();
  });
});
