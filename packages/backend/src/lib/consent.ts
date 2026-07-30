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
import type { DbExecutor } from './transactions';

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

/** 거절해도 서비스 이용에 지장이 없는 선택 동의. */
export const OPTIONAL_CONSENT_TYPES = ['marketing'] as const;

/** 동의 상태 조회/충족 판정에 쓰는 일반 필수 동의 목록(GET /consents/status 호환). */
export const REQUIRED_CONSENT_TYPES = GENERAL_REQUIRED_CONSENTS;

/** 처리방침/약관 문서 버전. **새로 기록하는** 동의는 예외 없이 이 값으로 저장한다 —
 *  POST /user/consents 는 요청 바디의 version 을 받기만 하고 무시한다(클라가 보낸 버전을
 *  그대로 쓰면 위조된 높은 값이 이후의 재동의 요구를 영구히 무력화한다).
 *  재동의가 필요한지는 이 값이 아니라 CONSENT_MIN_POLICY_VERSION 이 결정한다.
 *  '4' (2026-07-30 개정): 제공하지 않는 기능·경로를 고지에서 걷어냈다 — Apple 로그인,
 *  캐릭터 성장/연속 기상 기록, Apple·PortOne 수탁. 결제는 Google Play 인앱결제 단일
 *  경로임을 명시. 마케팅 야간 수신 별도 동의는 발송 시간대 제한(08:00~21:00)으로 대체.
 *  '3' (2026-06-29 개정): 운영 음성 AI 제공자를 ElevenLabs 기준으로 정정하고,
 *  음성=민감정보/생체정보 분류, voice_biometric·overseas_transfer 별도 동의 서버 강제,
 *  Firebase/FCM 수탁 고지를 포함한 처리방침/약관 개정과 동기화한다.
 *  (docs/legal/*.ko.md 의 "최종 개정일"·"정책 버전"과 일치) */
export const CURRENT_POLICY_VERSION = '4';

/**
 * 유형별 **최소 정책 버전** — 기록된 동의가 이 버전 이상이어야 유효하다.
 *
 * 전부 3 인 이유: 버전 4(2026-07-30)는 수집 항목·수탁사·제공 범위를 **줄이기만 한 축소
 * 개정**이라 어느 유형의 동의 내용도 바뀌지 않았다. 축소된 범위는 이미 받아 둔 동의 안에
 * 들어오므로 재동의 사유가 아니다. 현재 사용자 기록은 모두 3 이라 전원 그대로 유효하다.
 *
 * 올리는 기준: **그 유형의 동의 내용이 실제로 바뀔 때만** 해당 유형만 올린다 —
 * 수집 항목·이용 목적·보유 기간 확대, 새 제3자 제공/국외 이전, 처리 방식 변경 등.
 * 문서 버전(CURRENT_POLICY_VERSION)이 올랐다는 이유만으로 올리지 말 것. 여기서 올린
 * 유형만 재동의 화면에 뜨고, 나머지 유형의 기존 동의(특히 marketing)는 보존된다.
 */
export const CONSENT_MIN_POLICY_VERSION: Record<ConsentType, number> = {
  terms: 3,
  privacy: 3,
  age14: 3,
  marketing: 3,
  voice_biometric: 3,
  overseas_transfer: 3,
};

/** 유형별 최신 동의 1건의 상태. version 은 파싱된 정수(파싱 실패 시 0). */
export type LatestConsent = { agreed: boolean; version: number };
export type LatestConsentMap = ReadonlyMap<string, LatestConsent>;

/** 정책 버전 문자열('1'…'4') → 정수. 파싱 불가/빈 값은 0 으로 떨어뜨려 재동의를 요구한다. */
function parsePolicyVersion(raw: string): number {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
}

/** 알 수 없는 유형은 현재 문서 버전을 요구한다(fail-safe). */
function minPolicyVersionOf(type: string): number {
  return (
    CONSENT_MIN_POLICY_VERSION[type as ConsentType] ?? parsePolicyVersion(CURRENT_POLICY_VERSION)
  );
}

/** user_consents 에서 유형별 최신 1건을 읽어 온다 (created_at DESC, rowid DESC). */
export async function loadLatestConsents(
  db: DbExecutor,
  userIdPK: string,
): Promise<LatestConsentMap> {
  const res = await db.execute({
    // created_at 은 초 단위라 같은 초에 토글하면 동점이 된다. rowid(삽입 순서)를
    // 보조 정렬로 두어 같은 초여도 항상 마지막 삽입을 최신으로 선택한다.
    sql: `SELECT consent_type, policy_version, agreed
          FROM user_consents WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
    args: [userIdPK],
  });
  const latest = new Map<string, LatestConsent>();
  for (const row of res.rows) {
    const type = String(row.consent_type);
    if (latest.has(type)) continue; // 유형별 최신 1건만
    latest.set(type, {
      agreed: Number(row.agreed) === 1,
      version: parsePolicyVersion(String(row.policy_version)),
    });
  }
  return latest;
}

/**
 * 그 유형에 대해 **최소 버전 이상으로 답한 기록이 있는가**(동의/거절 무관).
 * 선택 동의(marketing)는 거절도 유효한 응답이라 다시 물으면 안 되므로 agreed 를 보지 않는다.
 */
export function consentAnswerIsCurrent(latest: LatestConsentMap, type: string): boolean {
  const cur = latest.get(type);
  return !!cur && cur.version >= minPolicyVersionOf(type);
}

/** types 중 (미기록 | 미동의 | 최소 버전 미달) 인 것 — 필수 동의 충족 판정의 단일 구현. */
export function missingConsentTypesFrom(
  latest: LatestConsentMap,
  types: readonly string[],
): string[] {
  return types.filter((type) => {
    const cur = latest.get(type);
    return !cur || !cur.agreed || cur.version < minPolicyVersionOf(type);
  });
}

/** requiredTypes 중 충족되지 않은 유형 전부. */
export async function missingConsentTypes(
  db: DbExecutor,
  userIdPK: string,
  requiredTypes: readonly string[],
): Promise<string[]> {
  if (requiredTypes.length === 0) return [];
  return missingConsentTypesFrom(await loadLatestConsents(db, userIdPK), requiredTypes);
}

/** 충족되지 않은 첫 유형(없으면 null). 403 응답에 어떤 동의가 빠졌는지 싣는 용도. */
export async function missingConsentType(
  db: DbExecutor,
  userIdPK: string,
  requiredTypes: readonly string[],
): Promise<string | null> {
  return (await missingConsentTypes(db, userIdPK, requiredTypes))[0] ?? null;
}

export async function needsConsent(
  db: DbExecutor,
  userIdPK: string,
  requiredTypes: readonly string[],
): Promise<boolean> {
  return (await missingConsentTypes(db, userIdPK, requiredTypes)).length > 0;
}
