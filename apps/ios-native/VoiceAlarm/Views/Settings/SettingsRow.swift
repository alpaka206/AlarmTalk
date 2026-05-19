import SwiftUI

/// 설정 화면에서 쓰는 라벨/값/액션 행 공통 컴포넌트.
///
/// ContentView 의 `settingsRow(label:value:)` 와 `settingsActionRow(label:icon:action:)`
/// 헬퍼를 단일 파일로 모은 것. 같은 패딩/폰트를 일관되게 적용하기 위해 분리했다.

/// 단순 라벨 + 우측 값 + chevron 디스플레이용 row. 액션 없음.
struct SettingsRow: View {
    let label: String
    let value: String?

    var body: some View {
        HStack {
            Text(label)
                .fontWeight(.medium)
                .foregroundStyle(VoiceAlarmTheme.text)
            Spacer()
            if let value {
                Text(value)
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
                    .lineLimit(1)
            }
            Image(systemName: "chevron.right")
                .foregroundStyle(VoiceAlarmTheme.textSecondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// 좌측 아이콘 + 라벨 + chevron. 탭 시 액션 실행.
struct SettingsActionRow: View {
    let label: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .frame(width: 24)
                    .foregroundStyle(VoiceAlarmTheme.primaryDark)
                Text(label)
                    .fontWeight(.medium)
                    .foregroundStyle(VoiceAlarmTheme.text)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(VoiceAlarmTheme.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("SettingsRow (light)") {
    VStack(spacing: 0) {
        SettingsRow(label: "화면 모드", value: "시스템")
        Divider()
        SettingsActionRow(label: "초대 코드 등록", icon: "qrcode", action: {})
    }
    .settingsCard(title: "설정")
    .padding()
}

#Preview("SettingsRow (dark)") {
    VStack(spacing: 0) {
        SettingsRow(label: "화면 모드", value: "시스템")
        Divider()
        SettingsActionRow(label: "초대 코드 등록", icon: "qrcode", action: {})
    }
    .settingsCard(title: "설정")
    .padding()
    .preferredColorScheme(.dark)
}
#endif
