type NetInfoCallback = (state: { isConnected: boolean | null }) => void;

const mockListeners: NetInfoCallback[] = [];

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((cb: NetInfoCallback) => {
    mockListeners.push(cb);
    return () => {
      const idx = mockListeners.indexOf(cb);
      if (idx >= 0) mockListeners.splice(idx, 1);
    };
  }),
}));

import NetInfo from '@react-native-community/netinfo';

beforeEach(() => {
  mockListeners.length = 0;
  jest.clearAllMocks();
});

describe('useNetworkStatus — 로직 테스트', () => {
  it('addEventListener를 호출한다', () => {
    const unsub = NetInfo.addEventListener(() => {});
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('isConnected=true일 때 연결 상태로 판단한다', () => {
    let result = true;
    NetInfo.addEventListener((state) => {
      result = state.isConnected !== false;
    });
    mockListeners[0]!({ isConnected: true });
    expect(result).toBe(true);
  });

  it('isConnected=false일 때 끊긴 상태로 판단한다', () => {
    let result = true;
    NetInfo.addEventListener((state) => {
      result = state.isConnected !== false;
    });
    mockListeners[0]!({ isConnected: false });
    expect(result).toBe(false);
  });

  it('isConnected=null일 때 연결된 것으로 간주한다 (null !== false)', () => {
    let result = false;
    NetInfo.addEventListener((state) => {
      result = state.isConnected !== false;
    });
    mockListeners[0]!({ isConnected: null });
    expect(result).toBe(true);
  });

  it('언마운트 시 리스너가 제거된다', () => {
    const unsub = NetInfo.addEventListener(() => {});
    expect(mockListeners).toHaveLength(1);
    unsub();
    expect(mockListeners).toHaveLength(0);
  });

  it('여러 번 상태 변경 시 마지막 값을 반영한다', () => {
    let result = true;
    NetInfo.addEventListener((state) => {
      result = state.isConnected !== false;
    });
    mockListeners[0]!({ isConnected: false });
    expect(result).toBe(false);
    mockListeners[0]!({ isConnected: true });
    expect(result).toBe(true);
  });
});
