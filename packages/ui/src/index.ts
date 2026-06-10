// @alarmtalk/ui — 플랫폼 공통 디자인 토큰/상수의 단일 출처(source of truth).
// 색상·간격·타이포 토큰, 접근성(WCAG) 유틸, 온보딩/상태뷰 정의를 모은다.
// 네이티브 앱(Android/iOS)은 이 값을 코드로 직접 import 하지 않고 동일한
// 토큰을 각 플랫폼 리소스로 미러링하므로, 변경 시 양쪽을 함께 맞춰야 한다.
export {
  ColorPalette,
  LightColors,
  DarkColors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  FontFamily,
  getColors,
} from './tokens';

export type {
  ColorPaletteKey,
  SemanticColorKey,
  SpacingKey,
  BorderRadiusKey,
  FontSizeKey,
  FontWeightKey,
  FontFamilyKey,
} from './tokens';

export { resolveStateView } from './stateView';
export { ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, isLastStep, clampStepIndex } from './onboarding';
export type { OnboardingStep } from './onboarding';
export type { StateViewVariant, StateViewConfig } from './stateView';

export {
  MIN_TOUCH_TARGET,
  WCAG_AA_NORMAL,
  WCAG_AA_LARGE,
  relativeLuminance,
  contrastRatio,
  meetsAA,
} from './a11y';
