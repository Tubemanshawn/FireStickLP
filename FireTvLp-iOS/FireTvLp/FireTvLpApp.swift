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
            switch newPhase {
            case .active:
                Task {
                    await fire.connectIfNeeded()
                    await fire.wakeRemote()          // fast remote ready again
                }
            case .background:
                fire.appWentToBackground()           // don't leave the Home redirect paused
            default:
                break
            }
        }
    }
}
