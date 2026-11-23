// ===== FireTvLp for iPhone (B line) =====
// Replaces the Fire TV remote app: remote, RAM usage and debloat, talking to
// the Fire Stick over Wi-Fi ADB. Reconnects whenever the app comes back to
// the front (iOS drops the connection while the app is in the background).

import SwiftUI

@main
struct FireTvLpApp: App {
    @StateObject private var fire = FireStick()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(fire)
                .preferredColorScheme(.dark)
        }
        .onChange(of: phase) { newPhase in
            if newPhase == .active { Task { await fire.connectIfNeeded() } }
        }
    }
}
