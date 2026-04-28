const TOTAL_PAGES = 4;

const PAGE_EMOJIS = ['🎙️', '💌', '⏰', '🌱'];

function isLastPage(currentIndex: number): boolean {
  return currentIndex === TOTAL_PAGES - 1;
}

function getNextIndex(currentIndex: number): number | null {
  if (currentIndex < TOTAL_PAGES - 1) return currentIndex + 1;
  return null;
}

function shouldFinishOnboarding(currentIndex: number): boolean {
  return currentIndex === TOTAL_PAGES - 1;
}

function getButtonLabel(
  currentIndex: number,
  startLabel: string,
  nextLabel: string,
): string {
  return isLastPage(currentIndex) ? startLabel : nextLabel;
}

function getPageEmoji(index: number): string {
  return PAGE_EMOJIS[index] ?? '';
}

function getPageBgColor(
  index: number,
  background: string,
  surfaceVariant: string,
): string {
  return index === 0 || index === 3 ? background : surfaceVariant;
}

function computeDotWidth(
  scrollOffsetX: number,
  pageIndex: number,
  pageWidth: number,
): number {
  const progress = scrollOffsetX / pageWidth;
  const distance = Math.abs(progress - pageIndex);
  if (distance >= 1) return 8;
  return 8 + (24 - 8) * (1 - distance);
}

function computeDotOpacity(
  scrollOffsetX: number,
  pageIndex: number,
  pageWidth: number,
): number {
  const progress = scrollOffsetX / pageWidth;
  const distance = Math.abs(progress - pageIndex);
  if (distance >= 1) return 0.3;
  return 0.3 + (1 - 0.3) * (1 - distance);
}

function resolveIndexFromScroll(offsetX: number, pageWidth: number): number {
  return Math.round(offsetX / pageWidth);
}

describe('OnboardingScreen — page navigation', () => {
  it('starts at page 0', () => {
    expect(isLastPage(0)).toBe(false);
    expect(getNextIndex(0)).toBe(1);
  });

  it('advances from page 0 to 1', () => {
    expect(getNextIndex(0)).toBe(1);
  });

  it('advances from page 1 to 2', () => {
    expect(getNextIndex(1)).toBe(2);
  });

  it('advances from page 2 to 3', () => {
    expect(getNextIndex(2)).toBe(3);
  });

  it('returns null from last page (no more pages)', () => {
    expect(getNextIndex(3)).toBeNull();
  });

  it('identifies last page correctly', () => {
    expect(isLastPage(0)).toBe(false);
    expect(isLastPage(1)).toBe(false);
    expect(isLastPage(2)).toBe(false);
    expect(isLastPage(3)).toBe(true);
  });
});

describe('OnboardingScreen — shouldFinishOnboarding', () => {
  it('does not finish on intermediate pages', () => {
    expect(shouldFinishOnboarding(0)).toBe(false);
    expect(shouldFinishOnboarding(1)).toBe(false);
    expect(shouldFinishOnboarding(2)).toBe(false);
  });

  it('finishes on last page', () => {
    expect(shouldFinishOnboarding(3)).toBe(true);
  });
});

describe('OnboardingScreen — button label', () => {
  it('shows next label on non-last pages', () => {
    expect(getButtonLabel(0, '시작하기', '다음')).toBe('다음');
    expect(getButtonLabel(1, '시작하기', '다음')).toBe('다음');
    expect(getButtonLabel(2, '시작하기', '다음')).toBe('다음');
  });

  it('shows start label on last page', () => {
    expect(getButtonLabel(3, '시작하기', '다음')).toBe('시작하기');
  });
});

describe('OnboardingScreen — page content', () => {
  it('returns correct emoji for each page', () => {
    expect(getPageEmoji(0)).toBe('🎙️');
    expect(getPageEmoji(1)).toBe('💌');
    expect(getPageEmoji(2)).toBe('⏰');
    expect(getPageEmoji(3)).toBe('🌱');
  });

  it('returns empty string for out-of-range index', () => {
    expect(getPageEmoji(4)).toBe('');
    expect(getPageEmoji(-1)).toBe('');
  });

  it('assigns correct background color', () => {
    expect(getPageBgColor(0, '#FFF', '#EEE')).toBe('#FFF');
    expect(getPageBgColor(1, '#FFF', '#EEE')).toBe('#EEE');
    expect(getPageBgColor(2, '#FFF', '#EEE')).toBe('#EEE');
    expect(getPageBgColor(3, '#FFF', '#EEE')).toBe('#FFF');
  });
});

describe('OnboardingScreen — scroll index resolution', () => {
  const pageWidth = 375;

  it('resolves to page 0 at offset 0', () => {
    expect(resolveIndexFromScroll(0, pageWidth)).toBe(0);
  });

  it('resolves to page 1 at exact offset', () => {
    expect(resolveIndexFromScroll(pageWidth, pageWidth)).toBe(1);
  });

  it('rounds to nearest page', () => {
    expect(resolveIndexFromScroll(pageWidth * 0.4, pageWidth)).toBe(0);
    expect(resolveIndexFromScroll(pageWidth * 0.6, pageWidth)).toBe(1);
  });

  it('resolves to page 3 at last offset', () => {
    expect(resolveIndexFromScroll(pageWidth * 3, pageWidth)).toBe(3);
  });
});

describe('OnboardingScreen — dot indicator animation', () => {
  const pageWidth = 375;

  it('active dot has max width 24', () => {
    expect(computeDotWidth(0, 0, pageWidth)).toBe(24);
    expect(computeDotWidth(pageWidth, 1, pageWidth)).toBe(24);
  });

  it('inactive dot has min width 8', () => {
    expect(computeDotWidth(0, 2, pageWidth)).toBe(8);
    expect(computeDotWidth(pageWidth * 3, 0, pageWidth)).toBe(8);
  });

  it('interpolates width during scroll', () => {
    const halfScroll = pageWidth * 0.5;
    const w = computeDotWidth(halfScroll, 0, pageWidth);
    expect(w).toBeGreaterThan(8);
    expect(w).toBeLessThan(24);
  });

  it('active dot has max opacity 1', () => {
    expect(computeDotOpacity(0, 0, pageWidth)).toBe(1);
  });

  it('inactive dot has min opacity 0.3', () => {
    expect(computeDotOpacity(0, 2, pageWidth)).toBeCloseTo(0.3);
  });

  it('interpolates opacity during scroll', () => {
    const halfScroll = pageWidth * 0.5;
    const op = computeDotOpacity(halfScroll, 0, pageWidth);
    expect(op).toBeGreaterThan(0.3);
    expect(op).toBeLessThan(1);
  });
});

describe('OnboardingScreen — TOTAL_PAGES constant', () => {
  it('has exactly 4 pages', () => {
    expect(TOTAL_PAGES).toBe(4);
  });

  it('PAGE_EMOJIS matches TOTAL_PAGES', () => {
    expect(PAGE_EMOJIS.length).toBe(TOTAL_PAGES);
  });
});
