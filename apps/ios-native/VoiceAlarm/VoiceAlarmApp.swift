import SwiftUI

@main
struct VoiceAlarmApp: App {
    @StateObject private var alarmStore = LocalAlarmStore()
    @StateObject private var alarmKit = AlarmKitViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(alarmStore)
                .environmentObject(alarmKit)
                .task {
                    await alarmKit.startObserving(store: alarmStore)
                }
        }
    }
}

