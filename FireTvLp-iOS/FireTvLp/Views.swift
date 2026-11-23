// ===== Screens: Remote, RAM, Debloat, Setup =====

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var fire: FireStick

    var body: some View {
        TabView {
            RemoteView().tabItem { Label("Remote", systemImage: "gamecontroller") }
            RamView().tabItem { Label("RAM", systemImage: "memorychip") }
            DebloatView().tabItem { Label("Debloat", systemImage: "sparkles") }
            SetupView().tabItem { Label("Setup", systemImage: "gearshape") }
        }
        .tint(.orange)
    }
}

// MARK: - Status line

struct StatusLine: View {
    @EnvironmentObject var fire: FireStick

    private var color: Color {
        switch fire.status {
        case .connected: return .green
        case .connecting, .waitingForAllow: return .yellow
        case .disconnected: return .red
        }
    }
    private var text: String {
        switch fire.status {
        case .connected: return "Fire Stick connected"
        case .connecting: return "Connecting…"
        case .waitingForAllow: return "Press Allow on your TV"
        case .disconnected: return "Not connected"
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                Circle().fill(color).frame(width: 10, height: 10)
                Text(text).font(.subheadline.weight(.semibold))
                Spacer()
                if fire.status == .disconnected {
                    Button("Connect") { Task { await fire.connect() } }.buttonStyle(.bordered)
                }
            }
            if !fire.message.isEmpty && fire.status != .connected {
                Text(fire.message).font(.footnote).foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal)
    }
}

// MARK: - Remote

struct RemoteButton: View {
    let symbol: String
    var label: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: symbol).font(.title2)
                if let label { Text(label).font(.caption2) }
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Color(white: 0.16))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }
}

struct DPad: View {
    @EnvironmentObject var fire: FireStick

    private func arrow(_ symbol: String, _ key: Key) -> some View {
        Button { fire.press(key) } label: {
            Image(systemName: symbol).font(.title.weight(.bold))
                .frame(width: 70, height: 70)
                .foregroundColor(.white)
                .contentShape(Rectangle())
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(Color(white: 0.13)).frame(width: 250, height: 250)
            VStack(spacing: 0) {
                arrow("chevron.up", .up)
                HStack(spacing: 0) {
                    arrow("chevron.left", .left)
                    // OK: tap = OK, hold = long-press (move / uninstall menu)
                    Circle().fill(Color.orange).frame(width: 96, height: 96)
                        .overlay(Text("OK").font(.title2.bold()).foregroundColor(.white))
                        .onTapGesture { fire.press(.ok) }
                        .onLongPressGesture(minimumDuration: 0.5) { fire.longPressOK() }
                        .padding(6)
                    arrow("chevron.right", .right)
                }
                arrow("chevron.down", .down)
            }
        }
    }
}

struct RemoteView: View {
    @EnvironmentObject var fire: FireStick
    @State private var typed = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                StatusLine().padding(.top, 8)

                HStack(spacing: 10) {
                    RemoteButton(symbol: "arrow.uturn.backward", label: "Back") { fire.press(.back) }
                    RemoteButton(symbol: "house", label: "Home") { fire.press(.home) }
                    RemoteButton(symbol: "line.3.horizontal", label: "Menu") { fire.press(.menu) }
                }

                DPad()

                HStack(spacing: 10) {
                    RemoteButton(symbol: "backward.fill") { fire.press(.rewind) }
                    RemoteButton(symbol: "playpause.fill") { fire.press(.playPause) }
                    RemoteButton(symbol: "forward.fill") { fire.press(.forward) }
                }
                HStack(spacing: 10) {
                    RemoteButton(symbol: "speaker.minus", label: "Vol −") { fire.press(.volDown) }
                    RemoteButton(symbol: "speaker.slash", label: "Mute") { fire.press(.mute) }
                    RemoteButton(symbol: "speaker.plus", label: "Vol +") { fire.press(.volUp) }
                }
                HStack(spacing: 10) {
                    RemoteButton(symbol: "square.grid.2x2", label: "Apps") { fire.press(.apps) }
                    RemoteButton(symbol: "moon", label: "Sleep") { fire.press(.sleep) }
                    RemoteButton(symbol: "sun.max", label: "Wake") { fire.press(.wake) }
                }

                HStack {
                    TextField("Type on Fire TV, then Return", text: $typed)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.send)
                        .onSubmit { fire.type(typed); typed = "" }
                }
            }
            .padding()
        }
        .opacity(fire.isConnected ? 1 : 0.6)
    }
}

// MARK: - RAM

struct RamView: View {
    @EnvironmentObject var fire: FireStick
    @State private var poller: Task<Void, Never>?

    var body: some View {
        NavigationView {
            List {
                Section("Memory") {
                    if let r = fire.ram {
                        ProgressView(value: r.usedFraction)
                            .tint(r.usedFraction >= 0.9 ? .red : r.usedFraction >= 0.75 ? .yellow : .green)
                        Text("Used \(r.usedKB / 1024) MB of \(r.totalKB / 1024) MB (\(r.usedPct)%) · \(r.availKB / 1024) MB free" +
                             (r.usedPct < 50 ? " ✓ under 50%" : ""))
                            .font(.footnote)
                    } else {
                        Text(fire.isConnected ? "Reading…" : "Connect to see RAM.").foregroundColor(.secondary)
                    }
                    Button("🧹 Free RAM") { Task { await fire.freeRam() } }.disabled(!fire.isConnected)
                    if !fire.freeRamText.isEmpty { Text(fire.freeRamText).font(.footnote) }
                }
                Section {
                    ForEach(fire.ram?.apps ?? []) { a in
                        HStack {
                            Text((a.front ? "▶ " : "") + a.pkg)
                                .lineLimit(1).truncationMode(.middle)
                                .foregroundColor(a.mine ? .green : .primary)
                            Spacer()
                            Text("\(a.kb / 1024) MB").foregroundColor(.secondary).monospacedDigit()
                            if a.mine {
                                Button("Stop") { Task { await fire.stopApp(a.pkg) } }
                                    .buttonStyle(.bordered).tint(.red)
                            }
                        }
                        .font(.footnote)
                    }
                } header: {
                    Text("Running apps (\(fire.ram?.apps.count ?? 0))")
                } footer: {
                    Text("Sorted by memory. ▶ = on screen. Green = apps you installed (can be stopped).")
                }
            }
            .navigationTitle("RAM")
        }
        .navigationViewStyle(.stack)
        .onAppear {
            poller?.cancel()
            poller = Task {
                while !Task.isCancelled {
                    await fire.refreshRam()
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                }
            }
        }
        .onDisappear { poller?.cancel() }
    }
}

// MARK: - Debloat

struct DebloatView: View {
    @EnvironmentObject var fire: FireStick

    var body: some View {
        NavigationView {
            List {
                Section {
                    Toggle("Debloat every time the app connects", isOn: $fire.autoDebloat)
                    Button(fire.debloatBusy ? "Debloating…" : "Debloat now") {
                        Task { await fire.debloat(reason: "Debloat now") }
                    }
                    .disabled(fire.debloatBusy || !fire.isConnected)
                    Text(fire.debloatText).font(.footnote)
                } footer: {
                    Text("Fire OS turns Amazon's extra apps back on after reboots. This turns the \(DebloatList.packages.count) apps on the list back off (ads, telemetry, Alexa extras, updates and more), limits cached apps to 8, turns animations off and clears cached apps.")
                }
            }
            .navigationTitle("Debloat")
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Setup

struct SetupView: View {
    @EnvironmentObject var fire: FireStick

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("e.g. 192.168.1.50", text: Binding(
                        get: { fire.ip },
                        set: { fire.ip = IPFormatter.format(old: fire.ip, new: $0) }))
                        .keyboardType(.decimalPad)
                        .autocorrectionDisabled()
                    HStack {
                        Button("Connect") { Task { await fire.connect() } }
                        Spacer()
                        Button("Disconnect", role: .destructive) { Task { await fire.disconnect() } }
                    }
                    .buttonStyle(.bordered)
                    if !fire.message.isEmpty { Text(fire.message).font(.footnote).foregroundColor(.secondary) }
                } header: {
                    Text("Fire Stick address")
                } footer: {
                    Text("Find it on the Fire Stick: Settings → My Fire TV → About → Network.")
                }
                Section("First time") {
                    Text("1. On the Fire Stick: Settings → My Fire TV → Developer Options → ADB Debugging ON.")
                    Text("2. Type the IP above and press Connect. Allow Local Network if the iPhone asks.")
                    Text("3. On the TV, tick \"Always allow from this computer\" and press Allow.")
                    Text("4. If a PC app (Retro TV / FireTvLp) is open, set its 📡 PC remote to OFF first.")
                }
                .font(.footnote)
                Section {
                    LabeledContent("Version", value: FireStick.versionLabel)
                }
            }
            .navigationTitle("Setup")
        }
        .navigationViewStyle(.stack)
    }
}
