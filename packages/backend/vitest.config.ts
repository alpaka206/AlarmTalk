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
    hookTimeout: 30_000,
  },
});
