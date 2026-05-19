import SwiftUI

/// 빈 상태(아직 데이터가 없을 때) placeholder.
///
/// ContentView 의 `emptyState(title:subtitle:icon:)` 헬퍼를 그대로 옮긴 것.
/// 알람·음성·메시지·가족 그룹 등 거의 모든 빈 상태에서 같은 스타일을 쓰므로
/// 공통 컴포넌트로 분리했다.
struct EmptyStatePlaceholder: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(VoiceAlarmTheme.primaryDark)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VoiceAlarmTheme.text)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(VoiceAlarmTheme.surfaceVariant)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#if DEBUG
#Preview("Empty (light)") {
    EmptyStatePlaceholder(
        title: "아직 예약한 알람이 없어요.",
        subtitle: "새 알람을 만들면 iOS 로컬 저장소와 AlarmKit에 예약됩니다.",
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
