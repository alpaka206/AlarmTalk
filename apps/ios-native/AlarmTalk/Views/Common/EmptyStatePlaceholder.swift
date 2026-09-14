import SwiftUI

/// 빈 상태(아직 데이터가 없을 때) placeholder.
///
/// ContentView 의 `emptyState(title:subtitle:icon:)` 헬퍼를 그대로 옮긴 것.
/// 알람·음성·메시지·가족 그룹 등 거의 모든 빈 상태에서 같은 스타일을 쓰므로
/// 공통 컴포넌트로 분리했다.
struct EmptyStatePlaceholder: View {
    // 라벨은 `LocalizedStringKey` — `String` 이면 번역이 죽는다(`GradientCta.title` 주석).
    let title: LocalizedStringKey
    /// 없으면 제목만 그린다.
    var subtitle: LocalizedStringKey? = nil
    /// 아이콘이 없다고 맨 회색 한 줄을 따로 만들지 말 것 — 그렇게 갈라져서
    /// **같은 카드 안에** 아이콘 있는 빈 상태와 없는 빈 상태가 나란히 보였다.
    var icon: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let icon {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(AlarmTalkTheme.primary)
            }
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AlarmTalkTheme.text)
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(AlarmTalkTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AlarmTalkTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: AlarmTalkTheme.Shape.extraSmall, style: .continuous))
    }
}

#if DEBUG
#Preview("Empty (light)") {
    EmptyStatePlaceholder(
        title: "아직 예약한 알람이 없어요.",
        subtitle: "새 알람을 만들면 기기에 바로 예약돼요.",
        icon: "alarm"
    )
    .padding()
}

#Preview("Empty (dark)") {
    EmptyStatePlaceholder(
        title: "아직 사용할 수 있는 목소리가 없어요.",
        subtitle: "60초 이상 녹음한 뒤 학습을 등록해 주세요.",
        icon: "mic.slash"
    )
    .padding()
    .preferredColorScheme(.dark)
}
#endif
