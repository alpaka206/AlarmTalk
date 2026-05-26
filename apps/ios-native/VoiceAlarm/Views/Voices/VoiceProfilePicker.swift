import SwiftUI

/// 학습된 목소리 프로필 picker.
///
/// ContentView 의 voiceSection 안에 인라인으로 박혀 있던 Picker 를 분리.
/// 빈 목록 일 때는 EmptyStatePlaceholder 로 폴백한다. Phase 3-C4 가
/// VoiceProfileManagement 화면으로 확장한다.
struct VoiceProfilePicker: View {
    @EnvironmentObject private var voiceStudio: VoiceStudioViewModel

    var body: some View {
        if voiceStudio.profiles.isEmpty {
            EmptyStatePlaceholder(
                title: "아직 사용할 수 있는 목소리가 없어요.",
                subtitle: "60초 이상 녹음한 뒤 학습을 등록해 주세요.",
                icon: "mic.slash"
            )
        } else {
            Picker("사용할 목소리", selection: $voiceStudio.selectedProfileID) {
                Text("선택 안 함").tag(String?.none)
                ForEach(voiceStudio.profiles) { profile in
                    Text(pickerLabel(for: profile)).tag(Optional(profile.id))
                }
            }
        }
    }

    private func pickerLabel(for profile: VoiceProfile) -> String {
        let status = profile.status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case "", "ready":
            return profile.name
        case "processing":
            return "\(profile.name) · 학습 중"
        case "deleting":
            return "\(profile.name) · 삭제 중"
        case "failed":
            return "\(profile.name) · 실패"
        default:
            return "\(profile.name) · 상태 확인 중"
        }
    }
}

#if DEBUG
#Preview("VoiceProfilePicker (light)") {
    VoiceProfilePicker()
        .padding()
        .voiceAlarmPreviewEnvironment()
}

#Preview("VoiceProfilePicker (dark)") {
    VoiceProfilePicker()
        .padding()
        .preferredColorScheme(.dark)
        .voiceAlarmPreviewEnvironment()
}
#endif
