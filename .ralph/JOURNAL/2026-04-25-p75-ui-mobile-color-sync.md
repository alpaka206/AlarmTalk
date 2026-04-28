# P75 — packages/ui ↔ mobile/constants/theme 색상 동기화

## 선택한 항목
BACKLOG P75: `packages/ui/src/tokens.ts`와 `apps/mobile/src/constants/theme.ts` 간 색상 값 불일치 해소.

## 불일치 분석
비교 결과 총 **8건** 불일치 발견:

### Light mode (1건)
| 키 | tokens.ts (구) | theme.ts (정) |
|----|----------------|---------------|
| textTertiary | #9CA3AF | #AEAEB2 |

### Dark mode (7건)
| 키 | tokens.ts (구) | theme.ts (정) |
|----|----------------|---------------|
| background | #1A1A2E | #1C1C1E |
| surface | #232340 | #2C2C2E |
| surfaceVariant | #2D2D4A | #3A3A3C |
| text | #E8E8F0 | #FFFFFF |
| textSecondary | #8E8E93 | #98989D |
| textTertiary | #6B6B82 | #636366 |
| border | #3A3A55 | #38383A |

## 판단: 단일 소스 결정
**mobile `theme.ts`를 source of truth로 선택한 이유**:
1. web 패키지 삭제됨 → UI 패키지의 색상이 실제 렌더링에 사용되는 곳 없음
2. P74에서 mobile 색상을 WCAG AA 검증함 (textSecondary #6B7280/#98989D)
3. mobile dark 팔레트는 표준 iOS 시스템 색상 (#1C1C1E, #2C2C2E 등) 기반 → 플랫폼 네이티브 느낌
4. UI 패키지 dark 팔레트는 커스텀 보라빛 색조 (#1A1A2E, #232340 등) → web 대시보드용이었으나 더 이상 불필요

역방향 동기화(UI→mobile)는 부적절 — mobile이 이미 WCAG AA 검증 + iOS 네이티브 톤으로 정비됨.

## 변경 파일 (1개)
1. `packages/ui/src/tokens.ts` — ColorPalette 8개 값 변경 + DarkColors.textSecondary 하드코딩 제거 (→ ColorPalette.darkTextSecondary 참조)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 724/724, mobile 625/625, UI 38/38 (전체 통과)
- WCAG AA: UI 패키지 a11y 테스트 3건 (text-on-background light/dark, primary-on-surface) 통과 — 동기화된 값이 기존 대비 테스트와 호환

## 다음 루프 참고
- 향후 UI 패키지를 모바일 의존성으로 추가하여 import 체인을 만들면 완전한 단일 소스 달성 가능
- 현재는 값만 동기화한 상태 (두 파일 모두 유지, 값 일치)
- FontFamily도 tokens.ts에 system/mono가 추가로 있으나 mobile에서 사용하지 않으므로 불일치 아님
