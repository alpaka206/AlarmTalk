import SwiftUI

/// 홈 화면 "바로 가기" 영역. 음성 탭 진입, 새 알람 만들기, 코드/공유 이용권 시트 진입.
///
/// ContentView 의 `quickStartGrid` 와 `quickActionCard(_:_:_:_:)` 헬퍼를 옮긴 것.
/// 부모(HomeView)가 라우팅 의무를 가져가므로 각 카드는 단순 콜백을 호출한다.
struct QuickStartGrid: View {
    let onOpenVoices: () -> Void
    let onOpenEditor: () -> Void
    let canCreateFamilyAlarm: Bool
    let onOpenFamilyAlarm: () -> Void
    let peopleTitle: String
    let onOpenPeople: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("바로 가기")
                .font(.headline)
                .foregroundStyle(VoiceAlarmTheme.text)
            HStack(spacing: 12) {
                QuickActionCard(
                    title: "알람 음성",
                    icon: "mic",
                    background: Color(red: 0.86, green: 0.91, blue: 0.96),
                    action: onOpenVoices
                )
                QuickActionCard(
                    title: "새 알람",
                    icon: "alarm",
                    background: Color(red: 0.98, green: 0.89, blue: 0.58),
                    action: onOpenEditor
                )
            }
            QuickActionCard(
                title: peopleTitle,
                icon: "person.2",
                background: Color(red: 0.92, green: 0.88, blue: 0.96),
                action: onOpenPeople
            )
            if canCreateFamilyAlarm {
                QuickActionCard(
                    title: "상대 알람 맞춰주기",
                    icon: "bell.badge",
                    background: Color(red: 0.88, green: 0.95, blue: 0.91),
                    action: onOpenFamilyAlarm
                )
            }
        }
    }
}

/// 홈 바로가기에서 쓰는 카드 한 장. 아이콘 + 라벨 + 우측 화살표.
struct QuickActionCard: View {
    let title: String
    let icon: String
    let background: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(background)
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(VoiceAlarmTheme.text)
                }
                .frame(width: 42, height: 42)

                Text(title)
                    .font(.headline)
                    .foregroundStyle(VoiceAlarmTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer()
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(VoiceAlarmTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(VoiceAlarmTheme.surfaceVariant, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("QuickStart (light)") {
    QuickStartGrid(
        onOpenVoices: {},
        onOpenEditor: {},
        canCreateFamilyAlarm: true,
        onOpenFamilyAlarm: {},
        peopleTitle: "공유 이용권",
        onOpenPeople: {}
    )
        .padding()
}

#Preview("QuickStart (dark)") {
    QuickStartGrid(
        onOpenVoices: {},
        onOpenEditor: {},
        canCreateFamilyAlarm: true,
        onOpenFamilyAlarm: {},
        peopleTitle: "공유 이용권",
        onOpenPeople: {}
    )
        .padding()
        .preferredColorScheme(.dark)
}
#endif
