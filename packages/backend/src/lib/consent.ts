/**
 * 동의(consent) 설정의 단일 진실 공급원 + 서버측 동의 충족 판정 헬퍼 (B4).
 *
 * 개인정보보호법 제22조에 따라 동의 사실을 (유형, 정책 버전, 동의 여부, 시각)으로
 * 누적 보관한다. user_consents 테이블의 동일 (user_id, consent_type) 최신 행이
 * 현재 동의 상태이며, 이력은 INSERT 로만 누적된다.
 *
 * 동의 유형
 *  - terms            이용약관 (일반 필수)
 *  - privacy          개인정보 수집·이용 (일반 필수)
 *  - age14            만 14세 이상 (일반 필수)
 *  - marketing        광고성 정보 수신 (선택)
 *  - voice_biometric  음성(생체정보) 처리 — 음성 클론/등록 시 별도 필수.
 *                     클론된 목소리는 개인을 식별·재현할 수 있는 **생체정보**로 분류한다
 *                     (법적 문구는 후속 wave 에서 정비).
 *  - overseas_transfer 국외 이전 — 크로스보더 TTS/번역(Vertex)이 텍스트를 국외로
 *                     전송하므로 해당 경로 사용 시 별도 필수.
 */
import type { Client } from '@libsql/client/web';

export const CONSENT_TYPES = [
  'terms',
  'privacy',
  'age14',
  'marketing',
  'voice_biometric',
  'overseas_transfer',
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

/** POST /user/consents 로 기록 가능한 유형 집합. */
export const ALLOWED_CONSENT_TYPES = new Set<string>(CONSENT_TYPES);

/** 가입/일반 이용에 반드시 필요한 필수 동의. marketing(선택)·민감동의는 제외. */
export const GENERAL_REQUIRED_CONSENTS = ['terms', 'privacy', 'age14'] as const;

/** 특정 민감 기능(생체 음성, 국외 이전)에서만 추가로 요구되는 동의. */
export const SENSITIVE_REQUIRED_CONSENTS = ['voice_biometric', 'overseas_transfer'] as const;

/** 동의 상태 조회/충족 판정에 쓰는 일반 필수 동의 목록(GET /consents/status 호환). */
export const REQUIRED_CONSENT_TYPES = GENERAL_REQUIRED_CONSENTS;

/** 처리방침/약관 버전. 정책 개정 시 이 값을 올려 기존 가입자 재동의를 유도한다.
 *  '3' (2026-06-29 개정): 운영 음성 AI 제공자를 ElevenLabs 기준으로 정정하고,
 *  음성=민감정보/생체정보 분류, voice_biometric·overseas_transfer 별도 동의 서버 강제,
 *  Firebase/FCM·PortOne 수탁 고지를 포함한 처리방침/약관 개정과 동기화한다.
 *  (docs/legal/*.ko.md 의 "최종 개정일"·"정책 버전"과 일치) */
export const CURRENT_POLICY_VERSION = '3';

/**
 * requiredTypes 중 하나라도 (미기록 | 미동의 | 현재 정책버전과 불일치) 이면 true.
 * user_consents 의 유형별 최신 1건만 보고 판정한다 (created_at DESC, rowid DESC).
 */
export async function missingConsentType(
  db: Client,
  userIdPK: string,
  requiredTypes: readonly string[],
): Promise<string | null> {
  if (requiredTypes.length === 0) return null;
  const res = await db.execute({
    // created_at 은 초 단위라 같은 초에 토글하면 동점이 된다. rowid(삽입 순서)를
    // 보조 정렬로 두어 같은 초여도 항상 마지막 삽입을 최신으로 선택한다.
    sql: `SELECT consent_type, policy_version, agreed
          FROM user_consents WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
    args: [userIdPK],
  });
  const latest = new Map<string, { agreed: boolean; version: string }>();
  for (const row of res.rows) {
    const type = String(row.consent_type);
    if (latest.has(type)) continue; // 유형별 최신 1건만
    latest.set(type, {
      agreed: Number(row.agreed) === 1,
      version: String(row.policy_version),
    });
  }
  for (const type of requiredTypes) {
    const cur = latest.get(type);
    if (!cur || !cur.agreed || cur.version !== CURRENT_POLICY_VERSION) return type;
  }
  return null;
}

export async function needsConsent(
  db: Client,
  userIdPK: string,
  requiredTypes: readonly string[],
): Promise<boolean> {
  return (await missingConsentType(db, userIdPK, requiredTypes)) !== null;
}
