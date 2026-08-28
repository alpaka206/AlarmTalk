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
    case medication
    case weather

    var id: String { rawValue }

    /// ⚠ 순서는 안드로이드 `FreeBucketOrder` 그대로다. 이 순서가 "한 번도 고른 적 없을
    /// 때" 의 최후 폴백이기도 하다 — '항상 적용되는 기본값' 이 아니다(CLAUDE.md).
    static let order: [FreeBucket] = [.medication, .weather]

    /// **순서가 아니라 조건으로** 클립을 고르는 테마. 회전을 전진시키지 않는다.
    ///
    /// 날씨는 그날 날씨에, 운세는 그날 운세에 맞는 클립을 골라야 한다 — 순서를 돌리면
    /// 비 오는 날 맑음 문구가 나온다. 안드로이드 `AlarmRepository.MATCHING_BUCKET_IDS`
    /// 와 같은 집합이다(운세는 유료 클론 전용이라 이 열거형에는 없지만, 문자열로 비교하는
    /// 자리에서 함께 걸러야 해서 여기 둔다).
    static let matchingBucketIDs: Set<String> = ["weather", "fortune"]

    var label: String {
        switch self {
        case .medication: return "약"
        case .weather: return "날씨"
        }
    }
}

/// 무료 테마 요약 행 — 편집기 목소리 카드 안.
struct FreeThemeSummaryRow: View {
    let selectedBucket: FreeBucket?
    let weatherCity: String
    let onTap: () -> Void

    @ObservedObject private var network = NetworkMonitor.shared

    private var value: String {
        guard let selectedBucket else {
            // ⚠ **오프라인이면 '준비 중' 이라고 속이지 않는다.** 2026-08-18 전에는 이 주석만
            // 있고 코드는 언제나 "불러오는 중이에요" 를 돌려줬다 — iOS 에 연결 상태를 보는
            // 수단이 아예 없었다(`NetworkMonitor` 를 그래서 만들었다). 비행기모드에서는
            // 영원히 오지 않을 것을 기다린다고 말하고 있었던 셈이다.
            // 안드로이드는 처음부터 두 문구를 나눠 갖고 있었다
            // (`editor_free_bucket_loading` / `editor_free_bucket_offline`).
            return network.isOnline ? "문구를 준비하고 있어요" : "오프라인이라 문구를 불러오지 못했어요"
        }
        // 날씨 버킷은 어느 도시 기준인지 함께 보여준다(예: "날씨 · 서울").
        let city = weatherCity.trimmingCharacters(in: .whitespaces)
        if selectedBucket == .weather, !city.isEmpty {
            return "\(selectedBucket.label) · \(city)"
        }
        return selectedBucket.label
    }

    var body: some View {
        AlarmSettingRow(title: "문구", subtitle: value, onTap: onTap)
    }
}

/// 무료·기본목소리 문구 화면 — 진동·스누즈와 같은 드릴인 서브페이지 문법.
///
/// ⚠ **유료 문구 화면(`MessageSettingsPane`)과 같은 규약을 지킨다.** 두 화면이 하는 일이
/// 같으므로 동작도 같아야 한다:
///  - 값이 **없을 때만** 고르는 순간 입력창이 뜬다. 이미 있으면 선택만 된다.
///  - 입력창은 자기만 닫는다 — 이 목록은 그대로 남는다.
///  - 등록한 값을 바꾸는 길은 아래 상세 카드의 '변경하기' **하나**다.
///  - 지역 입력은 설정 화면과 **같은** `WeatherCityPickerSheet` 를 쓴다.
struct FreeBucketSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let available: [FreeBucket]
    let initialSelection: FreeBucket?

    /// 지금 저장된 날씨 도시(없으면 빈 문자열).
    let weatherCity: String
    /// 지금 저장된 직접 입력 문구(없으면 빈 문자열).
    let manualText: String

    /// **직접 입력이 잠기는가.** ⚠ 판정은 **무료 플랜 단독**이다 — 기본(시스템) 목소리를
    /// 골랐다는 것은 이유가 되지 않는다. 유료면 기본 목소리로도 직접 입력을 쓸 수 있고
    /// 횟수만 차감된다(2026-08-11 확정).
    let manualLocked: Bool

    /// 이번 달 직접 입력 **남은 횟수 / 전체 한도**. 유료 문구 화면(`MessageSettingsPane`)과
    /// **같은 모양**으로 라벨 옆에 붙인다 — 기본 목소리로도 직접 입력을 쓸 수 있으므로
    /// 여기서도 남은 횟수를 알려 줘야 한다(안드로이드 `FreeBucketSettingsPane` 과 같다).
    /// 둘 중 하나라도 없거나 한도가 0 이면 붙이지 않는다(무료는 어차피 잠겨 있다).
    var manualRemaining: Int?
    var manualLimit: Int?

    /// 지금 '직접 입력' 이 선택돼 있는가.
    let manualSelected: Bool

    /// 테마를 골랐을 때. 도시가 없으면 호출부가 지역 시트를 띄운다.
    let onSave: (FreeBucket) -> Void
    /// '직접 입력' 을 고르거나 그 문구를 바꿀 때.
    let onSelectManual: () -> Void
    /// 잠긴 '직접 입력' 행을 눌렀을 때 — 유료 안내로 보낸다.
    ///
    /// 이 행이 없으면 **유료에 무엇이 있는지 알 길이 없다** — 안드로이드는 "목록에서 아예
    /// 빼면 이런 기능이 있는지조차 모르고, 유료 전환 동기 중 가장 강한 것을 잃는다" 고
    /// 적어 두고 잠긴 행을 남긴다.
    let onManualLocked: () -> Void
    /// 날씨 지역을 바꿀 때 — 상세 카드의 '변경하기'.
    let onChangeWeather: () -> Void

    /// 사용자가 이 화면에서 **직접 고른** 테마. 아무것도 안 골랐으면 nil 이다.
    ///
    /// ⚠ **여기에 초기값을 찍어 넣지 말 것.** 예전에는 `.onAppear` 에서
    /// `draft = initialSelection ?? available.first` 로 **한 번만** 찍었는데, 첫 진입에는
    /// 스톡 매니페스트가 아직 안 와서 `available` 이 비어 있고 `initialSelection` 도 nil 이라
    /// **draft 가 nil 로 굳었다.** 그 뒤 목록만 채워져, 행은 보이는데 **선택 표시가 하나도
    /// 없는** 화면이 됐다(2026-08-12 실기기 재현 — 두 번째로 들어가면 멀쩡해 보였다).
    /// 지금은 아래 `selection` 이 매번 다시 계산한다.
    @State private var draft: FreeBucket?
    /// 이 화면에서 '직접 입력' 을 골랐는가. 부모 상태(`manualSelected`)를 초기값으로 쓰되,
    /// 화면 안에서 테마를 고르면 꺼진다.
    @State private var manualDraft: Bool?

    /// 실제로 선택된 것으로 **보여줄** 값. 늦게 도착한 목록에도 자동으로 맞는다.
    private var selection: FreeBucket? {
        if manualChosen { return nil }
        return draft ?? initialSelection ?? available.first
    }

    private var manualChosen: Bool { manualDraft ?? manualSelected }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EditorCard(verticalPadding: 0) {
                        ForEach(Array(available.enumerated()), id: \.element.id) { index, bucket in
                            if index > 0 { AlarmSettingDivider() }
                            RadioRow(label: bucket.label, selected: selection == bucket) {
                                manualDraft = false
                                draft = bucket
                                // 값이 **없을 때만** 묻는다 — 호출부가 판단한다.
                                onSave(bucket)
                            }
                        }
                        AlarmSettingDivider()
                        manualRow
                    }

                    detailCard

                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
        }
        .homeGradientBackground()
        .navigationTitle("문구")
        // ⚠ 부모(편집기)가 상단바를 숨기므로 여기서 명시적으로 켠다 —
        // 번지면 뒤로갈 길이 사라진다(`AlarmSettingsPanes.PaneScaffold` 주석 참조).
        .toolbar(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// '직접 입력' 행. 잠겨 있으면 자물쇠 배지를, 아니면 라디오를 그린다.
    ///
    /// ⚠ **잠기지 않았는데 자물쇠를 그리지 말 것.** 예전에는 플랜과 무관하게 늘 자물쇠였고,
    /// 유료 사용자가 눌러도 "기본 목소리로는 직접 입력을 쓸 수 없어요" 로 막혔다.
    @ViewBuilder
    private var manualRow: some View {
        if manualLocked {
            Button(action: onManualLocked) {
                HStack(spacing: 10) {
                    Text("직접 입력")
                        .font(theme.typography.bodyLarge)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                    Spacer()
                    // ⚠ 라디오 점보다 크게 둔다(2026-08-15 지시). 안드로이드 `SnoozeLockedRow` 와 같은 값.
                    FeatureLockBadge(size: 24, iconSize: 14)
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            RadioRow(label: manualRowLabel, selected: manualChosen) {
                manualDraft = true
                draft = nil
                // 문구가 **없을 때만** 입력창이 뜬다 — 호출부가 판단한다.
                onSelectManual()
            }
        }
    }

    /// 예: "직접 입력 (96/100)" — 이번 달 남은/총 만들기 횟수.
    private var manualRowLabel: String {
        guard let remaining = manualRemaining, let limit = manualLimit, limit > 0 else {
            return "직접 입력"
        }
        return "직접 입력 (\(max(remaining, 0))/\(limit))"
    }

    /// 등록한 값과 '변경하기'. 유료 문구 화면과 **같은 컴포넌트**다.
    @ViewBuilder
    private var detailCard: some View {
        if manualChosen, !manualLocked {
            // ⚠ **문구를 반드시 함께 보여준다.** 생성형은 내용이 매번 새로 만들어져 틀릴
            // 일이 없지만 직접 입력은 글자가 그대로다 — 안 보이면 어제 문구를 물고 온
            // 새 알람을 알아챌 방법이 없다.
            PromptDetailCard(
                title: "문구",
                value: manualText.isEmpty ? "아직 입력하지 않았어요" : manualText,
                onChange: onSelectManual
            )
        } else if selection == .weather {
            PromptDetailCard(
                title: "날씨 지역",
                value: weatherCity.isEmpty ? "아직 고르지 않았어요" : weatherCity,
                onChange: onChangeWeather
            )
        }
    }
}
