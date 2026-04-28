interface PlanOption {
  key: string;
  nameKey: string;
  priceKey: string;
  descKey: string;
  features: string[];
}

const PLANS: PlanOption[] = [
  {
    key: 'free',
    nameKey: 'subscription.planFreeName',
    priceKey: 'subscription.planFreePrice',
    descKey: 'subscription.planFreeDesc',
    features: [
      'subscription.featureVoice1',
      'subscription.featureAlarmBasic',
      'subscription.featureCharacter',
    ],
  },
  {
    key: 'personal',
    nameKey: 'subscription.planPlusName',
    priceKey: 'subscription.planPlusPrice',
    descKey: 'subscription.planPlusDesc',
    features: [
      'subscription.featureVoice2',
      'subscription.featureAlarmUnlimited',
      'subscription.featureCharacter',
      'subscription.featurePresets',
    ],
  },
  {
    key: 'family',
    nameKey: 'subscription.planFamilyName',
    priceKey: 'subscription.planFamilyPrice',
    descKey: 'subscription.planFamilyDesc',
    features: [
      'subscription.featureVoice2',
      'subscription.featureAlarmUnlimited',
      'subscription.featureCharacter',
      'subscription.featurePresets',
      'subscription.featureFamilyGroup',
      'subscription.featureFamilyAlarm',
    ],
  },
];

function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

interface SubscriptionData {
  subscription: { expires_at: string } | null;
  plan: { plan_type: string; name: string } | null;
}

function getActivePlanType(data: SubscriptionData | undefined): string {
  return data?.plan?.plan_type ?? 'free';
}

function isPlanCurrent(
  planKey: string,
  activePlanType: string,
  hasSubscription: boolean,
): boolean {
  return (
    planKey === activePlanType ||
    (planKey === 'free' && activePlanType === 'free' && !hasSubscription)
  );
}

function isPlanUpgrade(planKey: string, activePlanType: string): boolean {
  return planKey !== 'free' && planKey !== activePlanType;
}

function formatDate(dateStr: string, lang: string): string {
  return new Date(dateStr).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

describe('SubscriptionScreen business logic', () => {
  describe('PLANS constant', () => {
    it('has exactly 3 plans', () => {
      expect(PLANS).toHaveLength(3);
    });

    it('plans are ordered free → personal → family', () => {
      expect(PLANS.map((p) => p.key)).toEqual(['free', 'personal', 'family']);
    });

    it('all plans have unique keys', () => {
      const keys = PLANS.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('each plan has at least 1 feature', () => {
      for (const plan of PLANS) {
        expect(plan.features.length).toBeGreaterThan(0);
      }
    });

    it('free plan has fewest features', () => {
      const free = PLANS.find((p) => p.key === 'free')!;
      const personal = PLANS.find((p) => p.key === 'personal')!;
      expect(free.features.length).toBeLessThan(personal.features.length);
    });

    it('family plan has most features', () => {
      const family = PLANS.find((p) => p.key === 'family')!;
      const personal = PLANS.find((p) => p.key === 'personal')!;
      expect(family.features.length).toBeGreaterThan(personal.features.length);
    });

    it('all i18n keys follow subscription namespace', () => {
      for (const plan of PLANS) {
        expect(plan.nameKey).toMatch(/^subscription\./);
        expect(plan.priceKey).toMatch(/^subscription\./);
        expect(plan.descKey).toMatch(/^subscription\./);
        for (const f of plan.features) {
          expect(f).toMatch(/^subscription\./);
        }
      }
    });
  });

  describe('planTypeToUserPlan', () => {
    it('maps family → family', () => {
      expect(planTypeToUserPlan('family')).toBe('family');
    });

    it('maps personal → plus', () => {
      expect(planTypeToUserPlan('personal')).toBe('plus');
    });

    it('maps free → free', () => {
      expect(planTypeToUserPlan('free')).toBe('free');
    });

    it('maps unknown types to free', () => {
      expect(planTypeToUserPlan('enterprise')).toBe('free');
      expect(planTypeToUserPlan('')).toBe('free');
    });
  });

  describe('getActivePlanType', () => {
    it('returns plan_type when subscription data exists', () => {
      const data: SubscriptionData = {
        subscription: { expires_at: '2026-12-31' },
        plan: { plan_type: 'personal', name: 'Plus' },
      };
      expect(getActivePlanType(data)).toBe('personal');
    });

    it('returns free when plan is null', () => {
      const data: SubscriptionData = { subscription: null, plan: null };
      expect(getActivePlanType(data)).toBe('free');
    });

    it('returns free when data is undefined', () => {
      expect(getActivePlanType(undefined)).toBe('free');
    });

    it('returns plan_type even if subscription is null but plan exists', () => {
      const data: SubscriptionData = {
        subscription: null,
        plan: { plan_type: 'family', name: 'Family' },
      };
      expect(getActivePlanType(data)).toBe('family');
    });
  });

  describe('isPlanCurrent', () => {
    it('returns true when planKey matches activePlanType', () => {
      expect(isPlanCurrent('personal', 'personal', true)).toBe(true);
    });

    it('returns true for free plan when no subscription', () => {
      expect(isPlanCurrent('free', 'free', false)).toBe(true);
    });

    it('returns false for free plan when activePlanType is not free', () => {
      expect(isPlanCurrent('free', 'personal', true)).toBe(false);
    });

    it('returns false for personal when active is family', () => {
      expect(isPlanCurrent('personal', 'family', true)).toBe(false);
    });

    it('returns true for free when active is free and has subscription', () => {
      expect(isPlanCurrent('free', 'free', true)).toBe(true);
    });
  });

  describe('isPlanUpgrade', () => {
    it('returns true for personal when active is free', () => {
      expect(isPlanUpgrade('personal', 'free')).toBe(true);
    });

    it('returns true for family when active is free', () => {
      expect(isPlanUpgrade('family', 'free')).toBe(true);
    });

    it('returns true for family when active is personal', () => {
      expect(isPlanUpgrade('family', 'personal')).toBe(true);
    });

    it('returns false for free (cannot upgrade to free)', () => {
      expect(isPlanUpgrade('free', 'free')).toBe(false);
      expect(isPlanUpgrade('free', 'personal')).toBe(false);
    });

    it('returns false when already on the same plan', () => {
      expect(isPlanUpgrade('personal', 'personal')).toBe(false);
      expect(isPlanUpgrade('family', 'family')).toBe(false);
    });
  });

  describe('formatDate', () => {
    it('formats date in Korean locale', () => {
      const result = formatDate('2026-12-31T00:00:00Z', 'ko');
      expect(result).toContain('2026');
      expect(result).toContain('12');
      expect(result).toContain('31');
    });

    it('formats date in English locale', () => {
      const result = formatDate('2026-06-15T00:00:00Z', 'en');
      expect(result).toContain('2026');
      expect(result).toContain('June');
      expect(result).toContain('15');
    });

    it('defaults to English for unknown locale', () => {
      const result = formatDate('2026-03-01T00:00:00Z', 'ja');
      expect(result).toContain('2026');
    });
  });

  describe('plan feature overlap validation', () => {
    it('personal plan includes character feature from free plan', () => {
      const free = PLANS.find((p) => p.key === 'free')!;
      const personal = PLANS.find((p) => p.key === 'personal')!;
      expect(free.features).toContain('subscription.featureCharacter');
      expect(personal.features).toContain('subscription.featureCharacter');
    });

    it('personal plan upgrades voice1 → voice2 and alarmBasic → alarmUnlimited', () => {
      const free = PLANS.find((p) => p.key === 'free')!;
      const personal = PLANS.find((p) => p.key === 'personal')!;
      expect(free.features).toContain('subscription.featureVoice1');
      expect(personal.features).toContain('subscription.featureVoice2');
      expect(free.features).toContain('subscription.featureAlarmBasic');
      expect(personal.features).toContain('subscription.featureAlarmUnlimited');
    });

    it('family plan includes all personal features', () => {
      const personal = PLANS.find((p) => p.key === 'personal')!;
      const family = PLANS.find((p) => p.key === 'family')!;
      for (const feature of personal.features) {
        expect(family.features).toContain(feature);
      }
    });

    it('family plan has exclusive features not in personal', () => {
      const personal = PLANS.find((p) => p.key === 'personal')!;
      const family = PLANS.find((p) => p.key === 'family')!;
      const exclusive = family.features.filter((f) => !personal.features.includes(f));
      expect(exclusive.length).toBeGreaterThan(0);
      expect(exclusive).toContain('subscription.featureFamilyGroup');
      expect(exclusive).toContain('subscription.featureFamilyAlarm');
    });
  });
});
