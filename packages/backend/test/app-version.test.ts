import { describe, it, expect } from 'vitest';
import { appVersionPolicy } from '../src/lib/app-version';

describe('appVersionPolicy', () => {
  it('android 정책 반환', () => {
    const p = appVersionPolicy('android');
    expect(p.minSupported).toBeGreaterThanOrEqual(1);
    expect(p.latest).toBeGreaterThanOrEqual(p.minSupported);
    expect(p.storeUrl).toContain('play.google.com');
  });

it('대소문자 무시', () => {
    expect(appVersionPolicy('Android')).toEqual(appVersionPolicy('android'));
  });

  it('알 수 없는/빈 플랫폼은 android 로 폴백', () => {
    expect(appVersionPolicy('windows')).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy('')).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy(undefined)).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy(null)).toEqual(appVersionPolicy('android'));
  });

  it('minSupported 는 평소 1 이라 기존 사용자를 막지 않는다', () => {
    expect(appVersionPolicy('android').minSupported).toBe(1);
  });
});
