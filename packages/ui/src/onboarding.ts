export interface OnboardingStep {
  emoji: string;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    emoji: '🎙️',
    title: '누구의 목소리를 듣고 싶나요?',
    description:
      '엄마, 아빠, 연인, 친구...\n소중한 사람의 목소리를 등록해보세요.\n짧은 녹음이나 통화 녹음만 있으면 돼요.',
  },
  {
    emoji: '💌',
    title: '매일 따뜻한 메시지가 찾아와요',
    description: '"점심 잘 챙겨 먹어"\n"오늘도 고생 많았어"\n그 사람의 목소리로 응원을 받아보세요.',
  },
  {
    emoji: '⏰',
    title: '소중한 목소리로 하루를 시작하세요',
    description:
      '알람부터 퇴근 알림까지,\n하루 종일 소중한 사람의 목소리와 함께.\n지금 바로 시작해볼까요?',
  },
] as const;

export const ONBOARDING_STORAGE_KEY = 'voice_alarm_onboarding_completed';

export function isLastStep(index: number): boolean {
  return index >= ONBOARDING_STEPS.length - 1;
}

export function clampStepIndex(index: number): number {
  return Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1));
}
