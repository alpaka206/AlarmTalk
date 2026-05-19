import SwiftUI

/// 권한 상태/역할/만료일 등을 표시하는 capsule pill.
///
/// ContentView 의 `permissionPill(_:)` 헬퍼를 옮긴 것. 알람 권한 라벨,
/// 가족 그룹 역할, 구독 만료일 등 다양한 컨텍스트에서 동일 스타일을 쓴다.
struct PermissionPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(VoiceAlarmTheme.text)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(VoiceAlarmTheme.surfaceVariant, in: Capsule())
    }
}

/// 화면 상단 큰 제목 + 부제목 묶음.
///
/// ContentView 의 `screenHeader(title:subtitle:)` 를 옮긴 것.
/// 음성/알람/메시지 등 일반 탭과 보조 시트 모두에서 동일 스타일을 쓴다.
struct ScreenHeader: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(VoiceAlarmTheme.text)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
#Preview("Chips") {
    VStack(alignment: .leading, spacing: 16) {
        ScreenHeader(title: "알람", subtitle: "현재 활성 알람 3개")
        HStack {
            PermissionPill(text: "허용됨")
            PermissionPill(text: "만료 2026-06-01")
            PermissionPill(text: "owner")
        }
    }
    .padding()
}

#Preview("Chips (dark)") {
    VStack(alignment: .leading, spacing: 16) {
        ScreenHeader(title: "메시지")
        PermissionPill(text: "허용됨")
    }
    .padding()
    .preferredColorScheme(.dark)
}
#endif
