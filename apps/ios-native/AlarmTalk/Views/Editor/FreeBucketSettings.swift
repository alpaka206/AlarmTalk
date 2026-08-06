import SwiftUI

/// 무료 등급의 **테마(버킷)** 개념.
///
/// 안드로이드 `ui/editor/AlarmEditorControls.kt:456-478` 의 `FreeBucketOrder` /
/// `freeBucketsFor`. 무료 사용자는 개별 문구가 아니라 테마를 고르고, 그 테마 안의
/// 클립이 알람이 울릴 때마다 순차 회전한다.
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
                    }

                    Text("고른 테마의 문구가 알람마다 번갈아 나와요. 유료 이용권에서는 목소리를 직접 만들고 문구도 고를 수 있어요.")
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
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .onAppear { draft = initialSelection ?? available.first }
    }
}
