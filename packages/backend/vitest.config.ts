import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 일부 스위트(alarm-guard/family-alarm-guard/promo-welcome-group 등)는 beforeAll 에서
    // 전체 마이그레이션 체인(72+개)을 파일 기반 libSQL DB 에 실행한다. 느린 CI 러너에서 이게
    // vitest 기본 훅 타임아웃(10s)을 간헐적으로 넘겨 "Hook timed out" 으로 스위트가 로드
    // 실패했다(개별 테스트는 전부 통과). 여유를 두어 이 플레이크를 제거한다.
    // (hook 최악 실측 ~0.95s → CI 6~10배 부하시 ~7.6s. 30s 는 그 위 ~4배 마진.)
    hookTimeout: 30_000,
    // promo-welcome-group 등 일부 테스트는 **본문에서** runMigrationsRange(1,71~73) 로
    // 파일 DB 에 수십 개 마이그레이션을 재실행한다. 로컬 ~1.9s 가 CI 부하에서 5s(기본
    // testTimeout)를 넘겨 "Test timed out in 5000ms" 로 실패했다. 전수 감사에서 대상 전건이
    // 유한작업(hang 아님)으로 확인되어, 최악 추정(~10s) 위에 ~2배 마진인 20s 로 올린다.
    testTimeout: 20_000,
  },
});
