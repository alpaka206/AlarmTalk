export interface PresetCategory {
  key: string;
  emoji: string;
  i18nKey: string;
  messages: string[];
}

export function getCategoryLabel(cat: PresetCategory, t: (key: string) => string): string {
  return t(cat.i18nKey);
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    key: 'morning',
    emoji: '🌅',
    i18nKey: 'library.categoryMorning',
    messages: [
      '좋은 아침이야, 오늘도 화이팅!',
      '일어나~ 오늘도 좋은 하루 보내자!',
      '굿모닝! 오늘 하루도 힘내!',
    ],
  },
  {
    key: 'lunch',
    emoji: '🍽️',
    i18nKey: 'library.categoryLunch',
    messages: [
      '점심 잘 챙겨 먹어, 맛있는 거 먹어!',
      '밥 먹었어? 꼭 챙겨 먹어!',
      '점심시간이다! 맛있는 거 먹고 오후도 파이팅!',
    ],
  },
  {
    key: 'afternoon',
    emoji: '☕',
    i18nKey: 'library.categoryAfternoon',
    messages: [
      '오후도 힘내, 조금만 더 파이팅!',
      '오후 슬럼프? 커피 한 잔 하고 힘내!',
      '조금만 더 하면 끝이야, 화이팅!',
    ],
  },
  {
    key: 'evening',
    emoji: '🌙',
    i18nKey: 'library.categoryEvening',
    messages: [
      '오늘도 고생 많았어, 수고했어!',
      '퇴근 축하해! 오늘 하루도 잘 보냈어!',
      '고생했어, 이제 편하게 쉬어!',
    ],
  },
  {
    key: 'night',
    emoji: '😴',
    i18nKey: 'library.categoryNight',
    messages: [
      '오늘 하루도 잘 보냈어, 푹 자!',
      '잘 자, 좋은 꿈 꿔!',
      '내일도 좋은 하루 될 거야, 굿나잇!',
    ],
  },
  {
    key: 'cheer',
    emoji: '💪',
    i18nKey: 'library.categoryCheer',
    messages: [
      '넌 할 수 있어, 믿어!',
      '힘들어도 포기하지 마, 항상 응원해!',
      '넌 정말 대단한 사람이야!',
    ],
  },
  {
    key: 'love',
    emoji: '❤️',
    i18nKey: 'library.categoryLove',
    messages: ['사랑해, 항상 고마워!', '네가 있어서 행복해!', '보고 싶어, 빨리 보자!'],
  },
  {
    key: 'health',
    emoji: '🏥',
    i18nKey: 'library.categoryHealth',
    messages: ['약 챙겨 먹었어?', '물 많이 마셔! 건강 챙겨!', '오늘 스트레칭 했어? 몸 좀 풀어!'],
  },
];

export const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'] as const;
