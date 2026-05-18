import SwiftUI

@main
struct VoiceAlarmApp: App {
    @StateObject private var alarmStore = LocalAlarmStore()
    @StateObject private var alarmKit = AlarmKitViewModel()
    @StateObject private var auth = AuthViewModel()
    @StateObject private var remoteSync = RemoteAlarmSyncViewModel()
    @StateObject private var voiceStudio = VoiceStudioViewModel()
    @StateObject private var socialFeatures = SocialFeatureViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(alarmStore)
                .environmentObject(alarmKit)
                .environmentObject(auth)
                .environmentObject(remoteSync)
                .environmentObject(voiceStudio)
                .environmentObject(socialFeatures)
                .task {
                    await auth.restoreSession()
                    await alarmKit.startObserving(store: alarmStore)
                }
        }
    }
}

