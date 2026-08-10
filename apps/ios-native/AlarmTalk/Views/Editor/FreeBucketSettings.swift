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

    private var value: String {
        guard let selectedBucket else {
            // 오프라인이면 '준비 중' 이라고 속이지 않는다 — 연결이 돌아오면 자동 재시도한다.
            return "불러오는 중이에요"
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

/// 무료 테마 선택 화면 — 진동·스누즈와 같은 드릴인 서브페이지 문법.
struct FreeBucketSettingsPane: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let available: [FreeBucket]
    let initialSelection: FreeBucket?
    let onSave: (FreeBucket) -> Void
    /// 잠긴 '직접 입력' 행을 눌렀을 때. 이 행이 없으면 **유료에 무엇이 있는지 알 길이
    /// 없다** — 안드로이드는 "목록에서 아예 빼면 이런 기능이 있는지조차 모르고, 유료
    /// 전환 동기 중 가장 강한 것을 잃는다" 고 적어 두고 잠긴 행을 남긴다.
    var onManualLocked: (() -> Void)?

    @State private var draft: FreeBucket?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EditorCard(verticalPadding: 0) {
                        ForEach(Array(available.enumerated()), id: \.element.id) { index, bucket in
                            if index > 0 { AlarmSettingDivider() }
                            RadioRow(label: bucket.label, selected: draft == bucket) { draft = bucket }
                        }
                        if let onManualLocked {
                            AlarmSettingDivider()
                            Button(action: onManualLocked) {
                                HStack(spacing: 10) {
                                    Text("직접 입력")
                                        .font(theme.typography.bodyLarge)
                                        .foregroundStyle(theme.palette.onSurfaceVariant)
                                    Spacer()
                                    FeatureLockBadge(size: 18, iconSize: 11)
                                }
                                .frame(minHeight: 52)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Text("고른 테마의 문구가 알람마다 번갈아 나와요.")
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }

            EditorActionBar(
                saveTitle: "저장",
                saving: false,
                savingLabel: "",
                saveEnabled: draft != nil,
                onCancel: { dismiss() },
                onSave: {
                    if let draft { onSave(draft) }
                    dismiss()
                }
            )
        }
        .homeGradientBackground()
        .navigationTitle("문구")
        // ⚠ 부모(편집기)가 상단바를 숨기므로 여기서 명시적으로 켠다 —
        // 번지면 뒤로갈 길이 사라진다(`AlarmSettingsPanes.PaneScaffold` 주석 참조).
        .toolbar(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .onAppear { draft = initialSelection ?? available.first }
    }
}
