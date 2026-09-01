import SwiftUI

/// 무료 등급의 **테마(버킷)** 개념. 무료 사용자는 개별 문구가 아니라 테마를 고른다.
/// 안드로이드 `ui/editor/AlarmEditorControls.kt` 의 `FreeBucketOrder` / `freeBucketsFor`.
///
/// 테마 안의 클립은 **울릴 때마다 다음 것으로 넘어간다**(2026-08-08 구현).
/// 클립 키 목록과 인덱스를 알람 행에 영속하고(`bucketClipKeys`·`bucketRotationIndex`),
/// 울린 뒤 `LocalAlarmStore.markStopped` 가 인덱스를 올린 다음 **다시 예약**한다 —
/// AlarmKit 은 사운드 파일을 예약 시점에 받아 가므로 다시 예약하지 않으면 인덱스만
/// 올라가고 소리는 지난 회차 그대로다.
///
/// ⚠ **날씨·운세는 돌리지 않는다.** 그 둘은 순서가 아니라 조건으로 고른다.
///
/// ⚠ **버킷 안 개별 문구를 노출하지 말 것.** 예전 iOS 는 스톡 클립 본문을 행으로
/// 나열해서, 매일 도는 회전 클립 중 하나를 '내가 고른 문구' 로 오해하게 만들었다.
enum FreeBucket: String, CaseIterable, Identifiable {
    /// `preset`(기본 인사말)의 버킷 이름. 목소리 미리듣기와 같은 클립을 쓴다 —
    /// 클론도 `RandomPromptContext.preset.bucketCategory` 가 이것이다.
    case greeting
    case medication
    case weather
    case fortune
    case love

    var id: String { rawValue }

    /// ⚠ **손으로 적지 않는다.** 문구 종류 목록을 그대로 옮긴 것이다 — 안드로이드
    /// `FreeBucketOrder` 도 `EditorMessageContexts` 에서 유도한다. 2026-09-02 전에는
    /// 여기가 `[.medication, .weather]` 라 같은 '문구 종류' 가 **유료 5종 · 무료 2종**으로
    /// 갈라져 있었다. 그 차이는 제품 결정이 아니라 *기본 목소리에 운세·사랑 클립이 없었다*는
    /// 사정이었고, 클립을 채우고 나니 남을 이유가 없었다.
    ///
    /// ⚠ 이 순서는 "한 번도 고른 적 없을 때" 의 최후 폴백이기도 하다 — '항상 적용되는
    /// 기본값' 이 아니다(CLAUDE.md).
    /// ⚠ **`.preset`(기본 인사말)은 뺀다**(2026-09-02 리뷰). 안드로이드 `FreeBucketOrder`
    /// 와 같은 이유다: 스톡 `greeting` 은 목소리 미리듣기용 **자기소개**라 매일 아침 울릴
    /// 문구가 아니고(클론의 `preset` 은 생성된 기상 인사라 같은 이름의 다른 것이다),
    /// 서버도 시스템 보이스 + greeting 을 `INVALID_BUCKET_ID` 로 거절한다.
    static let order: [FreeBucket] = RandomPromptContext.alarmEditorCases
        .filter { $0 != .preset }
        .compactMap { FreeBucket(rawValue: $0.bucketCategory) }

    /// **순서가 아니라 조건으로** 클립을 고르는 테마. 회전을 전진시키지 않는다.
    ///
    /// 날씨는 그날 날씨에, 운세는 그날 운세에 맞는 클립을 골라야 한다 — 순서를 돌리면
    /// 비 오는 날 맑음 문구가 나온다. 안드로이드 `AlarmRepository.MATCHING_BUCKET_IDS`
    /// 와 같은 집합이다. (2026-09-02 정정: 예전 주석은 "운세는 유료 클론 전용이라 이
    /// 열거형에는 없다" 고 적었는데, 문구 목록을 합치면서 `fortune` 이 이 열거형에 들어왔다.)
    static let matchingBucketIDs: Set<String> = ["weather", "fortune"]

    /// ⚠ 라벨도 문구 종류에서 가져온다 — 같은 것을 두 이름으로 부르지 않는다.
    var label: String {
        RandomPromptContext.forBucket(rawValue)?.label ?? rawValue
    }
}
