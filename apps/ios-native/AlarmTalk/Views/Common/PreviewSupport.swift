#if DEBUG
import SwiftUI

/// SwiftUI Preview 전용 ViewModel 더미 헬퍼.
///
/// production 코드 흐름에는 절대 영향을 주지 않도록 `#if DEBUG` 가드 안에서만
/// 컴파일된다. 각 ViewModel 은 default-arg init 으로 만들 수 있으므로 Preview 에서는
/// 단순 빈 인스턴스를 돌려준다. 추후 더미 데이터가 필요한 경우 본 파일에서만
/// 셋업하면 된다.
extension AuthViewModel {
    static var preview: AuthViewModel { AuthViewModel() }
}

extension AlarmKitViewModel {
    static var preview: AlarmKitViewModel { AlarmKitViewModel() }
}

extension RemoteAlarmSyncViewModel {
    static var preview: RemoteAlarmSyncViewModel { RemoteAlarmSyncViewModel() }
}

extension VoiceStudioViewModel {
    static var preview: VoiceStudioViewModel { VoiceStudioViewModel() }
}

extension SocialFeatureViewModel {
    static var preview: SocialFeatureViewModel { SocialFeatureViewModel() }
}

extension LocalAlarmStore {
    static var preview: LocalAlarmStore { LocalAlarmStore() }
}

extension CharacterEventStore {
    /// Preview 용 더미 store. API 호출은 시도되지 않게 token provider 가 nil 만 돌려준다.
    static var preview: CharacterEventStore {
        CharacterEventStore(api: AlarmTalkAPI.shared, tokenProvider: { nil })
    }
}

extension SubscriptionManager {
    static var preview: SubscriptionManager {
        SubscriptionManager(api: AlarmTalkAPI.shared, authProvider: { nil })
    }
}

extension AppVersionGate {
    static var preview: AppVersionGate { AppVersionGate() }
}

/// 한 곳에서 본 앱이 환경에 주입하는 ViewModel 을 모두 attach 해 주는 헬퍼 modifier.
struct PreviewEnvironment: ViewModifier {
    func body(content: Content) -> some View {
        content
            .environmentObject(AuthViewModel.preview)
            .environmentObject(AlarmKitViewModel.preview)
            .environmentObject(RemoteAlarmSyncViewModel.preview)
            .environmentObject(VoiceStudioViewModel.preview)
            .environmentObject(SocialFeatureViewModel.preview)
            .environmentObject(LocalAlarmStore.preview)
            .environmentObject(CharacterEventStore.preview)
            .environmentObject(SubscriptionManager.preview)
            .environmentObject(AppVersionGate.preview)
    }
}

extension View {
    /// Preview 에서 본 앱과 동일한 ViewModel 을 한 줄로 주입.
    func voiceAlarmPreviewEnvironment() -> some View {
        modifier(PreviewEnvironment())
    }
}
#endif
