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

/**
 * 가입 동의 화면을 **통과하려면 반드시 체크해야 하는** 유형.
 *
 * `overseas_transfer` 가 여기 있는 이유: 무료 플랜의 기본 목소리 알람도 문구 생성(Vertex)과
 * 읽어주기(ElevenLabs)를 거쳐 데이터가 국외로 나간다. 거부하면 알람에 목소리를 못 붙이니
 * 사실상 서비스가 성립하지 않는다 — '선택 동의를 거부했다고 서비스를 거부' 하는 게 아니라
 * 계약 이행에 필요한 동의라서 가입 필수로 두는 것이다.
 *
 * `voice_biometric` 은 여기 **없다** — 아래 FEATURE_CONSENT_TYPES 를 볼 것.
 *
 * 미들웨어의 하드 게이트는 여전히 GENERAL_REQUIRED_CONSENTS 3종만 본다. 앱 자체를 막는
 * 범위는 최소로 두고, 음성 라우트는 SENSITIVE_REQUIRED_CONSENTS 를 따로 확인한다 —
 * 설정에서 동의를 철회한 경우에도 그 기능만 막히고 앱 전체가 잠기지는 않는다.
 */
export const REQUIRED_CONSENT_TYPES = [
  ...GENERAL_REQUIRED_CONSENTS,
  'overseas_transfer',
] as const;

/**
 * 그 기능을 쓸 때만 필요한 동의. **가입 화면에 '선택'으로 함께 노출하되, 거절해도 가입은
 * 통과시킨다.**
 *
 * `voice_biometric`(내 목소리 클론)이 여기 속한다. 내 목소리를 등록하지 않아도 기본 목소리
 * 알람으로 앱을 온전히 쓸 수 있으므로, 이 동의를 가입 조건으로 요구하면 개인정보보호법
 * 제22조제5항(선택 동의 거부를 이유로 한 서비스 제공 거부 금지)에 정면으로 걸린다.
 * 민감정보라 제23조의 '별도 동의' 요건도 있어 다른 필수 동의와 한 덩어리로 묶으면 안 된다.
 *
 * 대신 **가입 화면 안에** 선택 항목으로 둔다. 대부분은 거기서 한 번 체크하고 다시 볼 일이
 * 없어 등록 도중 모달이 뜨지 않는다. 거절한 사람에게만 목소리 등록 화면에서 다시 묻는다.
 */
export const FEATURE_CONSENT_TYPES = ['voice_biometric'] as const;

/** 처리방침/약관 문서 버전. **새로 기록하는** 동의는 예외 없이 이 값으로 저장한다 —
 *  POST /user/consents 는 요청 바디의 version 을 받기만 하고 무시한다(클라가 보낸 버전을
 *  그대로 쓰면 위조된 높은 값이 이후의 재동의 요구를 영구히 무력화한다).
 *  재동의가 필요한지는 이 값이 아니라 CONSENT_MIN_POLICY_VERSION 이 결정한다.
 *  '5' (2026-08-05 최초 작성 → 2026-08-24 보완): iOS 앱 제공에 따라 Apple 로그인
 *  (Sign in with Apple) 수집 항목과 App Store 인앱결제를 다시 고지하고, 위탁·국외이전 표에
 *  Apple 을 추가했다. 결제가 Google Play 단일 경로라는 기재를 앱 마켓별 경로로 정정.
 *  8-24 보완분: ① 확정된 목소리의 **원본 음성 보관 기간**을 '등록 7일 후 파기' 에서
 *  '목소리·계정 삭제 또는 유료 정리까지' 로 정정(실제 구현이 그러했다 — 고지가 틀렸다),
 *  ② **국외 이전 동의가 사실상 필수**임을 명시, ③ 환불·청약철회 권리가 마켓 정책만으로
 *  제한되지 않음을 명시.
 *
 *  ⚠ **왜 6 으로 올리지 않았나**(2026-08-26 결정). 버전을 태우는 이유는 딱 하나 —
 *  **앞 버전 본문에 동의한 사람**이 바뀐 본문에 동의한 것으로 취급되는 것을 막기 위해서다.
 *  그런데 버전 5 는 아직 **아무에게도 배포되지 않았다**: prod(`main`)의 이 상수는 여전히
 *  '4' 이고, 스토어의 앱도 4 를 담고 있다. 즉 **버전 5 본문으로 동의한 사용자는 0명**이라
 *  보호할 대상이 없다. 5 를 그대로 두고 본문만 고치는 것이 맞다.
 *  → **판정 기준: 이 상수가 `main` 에 올라갔는가.** 아직이면 그 번호의 본문은 초안이니
 *    제자리에서 고친다. 이미 올라갔으면 **반드시** 새 번호를 태운다(그때는 동의자가 있다).
 *  '4' (2026-07-30 개정): 제공하지 않는 기능·경로를 고지에서 걷어냈다 — Apple 로그인,
 *  캐릭터 성장/연속 기상 기록, Apple·PortOne 수탁. 결제는 Google Play 인앱결제 단일
 *  경로임을 명시. 마케팅 야간 수신 별도 동의는 발송 시간대 제한(08:00~21:00)으로 대체.
 *  '3' (2026-06-29 개정): 운영 음성 AI 제공자를 ElevenLabs 기준으로 정정하고,
 *  음성=민감정보/생체정보 분류, voice_biometric·overseas_transfer 별도 동의 서버 강제,
 *  Firebase/FCM 수탁 고지를 포함한 처리방침/약관 개정과 동기화한다.
 *  (docs/legal/*.ko.md 의 "최종 개정일"·"정책 버전"과 일치) */
export const CURRENT_POLICY_VERSION = '5';

/**
 * 유형별 **최소 정책 버전** — 기록된 동의가 이 버전 이상이어야 유효하다.
 *
 * 전부 3 인 이유: 버전 4(2026-07-30)는 수집 항목·수탁사·제공 범위를 **줄이기만 한 축소
 * 개정**이라 어느 유형의 동의 내용도 바뀌지 않았다. 축소된 범위는 이미 받아 둔 동의 안에
 * 들어오므로 재동의 사유가 아니다. 현재 사용자 기록은 모두 3 이라 전원 그대로 유효하다.
 *
 * ⚠ 버전 5(2026-08-05)에서도 **올리지 않았다.** 판단 근거:
 *   버전 5 는 Apple 을 국외이전 수탁자로 추가하므로 형식만 보면 아래 "새 제3자 제공/국외
 *   이전" 에 해당한다. 그러나 **Apple 로 나가는 데이터는 iOS 앱 이용자의 것뿐이다** —
 *   Android 이용자의 개인정보는 Apple 로 이전되지 않는다. 즉 지금 기록을 갖고 있는
 *   사용자(전원 Android)에게는 "그 유형의 동의 내용이 실제로 바뀌지" 않았다.
 *   iOS 이용자는 최초 가입 시점에 버전 5 본문으로 동의하므로 기록이 5 로 남아 정확하다.
 *   올리면 iOS 와 무관한 Android 베타 사용자 전원이 재동의 게이트를 다시 보게 되는데,
 *   그 마찰은 그들의 데이터 처리에 아무 변화가 없는데도 발생하는 것이다.
 *   → **이건 법무 판단이므로 사람이 확인할 것.** 되돌리려면 overseas_transfer 를 5 로 올린다.
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

/**
 * ⚠ **한 번 받은 동의는 다시 묻지 않는다 — 약관이 바뀌어 받아야 하는 경우만 예외**
 * (2026-08-26 확정). 이 파일에서 그 규칙을 집행하는 레버가 위 `CONSENT_MIN_POLICY_VERSION`
 * 하나다. 여기를 올리지 않는 한 이미 `agreed=1` 로 기록된 동의는 **어떤 경로에서도 다시
 * 요구되지 않는다** — 가입 때 받았든 첫 목소리를 등록할 때 받았든 마찬가지고, 두 번째·세
 * 번째 목소리를 등록할 때도 묻지 않는다.
 *
 * 그래서 "문서 버전이 올랐으니 최소 버전도 올린다" 는 **금지**다. 올리는 기준은 위 주석대로
 * **그 유형의 동의 내용이 실제로 바뀌었는가** 하나이고, 올린 유형만 재동의 화면에 뜬다.
 *
 * 2026-08-24 보완분(원본 음성 보관 기간 정정·국외 이전 필수 명시)에 대해서도 **올리지
 * 않았다.** 버전 5 자체가 미배포라 그 본문으로 동의한 사람이 없고(위 주석), 기존 사용자가
 * 동의한 3 의 내용은 바뀌지 않았기 때문이다. 새로 가입하는 사람은 보완된 본문으로 동의한다.
 *
 * 규칙 전문과 화면별 판정은 `docs/spec/consent.md` 의 「한 번 받은 동의는 다시 묻지 않는다」.
 */

/** 유형별 최신 동의 1건의 상태. version 은 파싱된 정수(파싱 실패 시 0). */
export type LatestConsent = { agreed: boolean; version: number };
export type LatestConsentMap = ReadonlyMap<string, LatestConsent>;

/** 정책 버전 문자열('1'…'4') → 정수. 파싱 불가/빈 값은 0 으로 떨어뜨려 재동의를 요구한다. */
function parsePolicyVersion(raw: string): number {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
}

/**
 * 저장된 기록의 버전을 읽을 때 쓰는 정규화.
 *
 * 현재 문서 버전보다 **큰** 값은 우리가 발급한 적이 없다 — 서버가 버전을 고정하기 전에는
 * 클라가 보낸 값을 그대로 저장했기 때문에, 위조·버그로 들어온 `999` 같은 행이 이미 남아 있을
 * 수 있다. 유효성 판정이 한쪽(최소 버전 이상)만 보기 때문에 그런 행은 **이후 모든 재동의를
 * 영구히 무력화한다.** 쓰기를 고정한 것만으로는 닫히지 않는 경로라(과거 행은 그대로다)
 * 읽는 쪽에서 0 으로 떨어뜨려 '답한 적 없음'으로 되돌린다 — 모르면 다시 묻는 쪽이 안전하다.
 */
function sanitizeStoredPolicyVersion(raw: string): number {
  const parsed = parsePolicyVersion(raw);
  return parsed > parsePolicyVersion(CURRENT_POLICY_VERSION) ? 0 : parsed;
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
      version: sanitizeStoredPolicyVersion(String(row.policy_version)),
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
