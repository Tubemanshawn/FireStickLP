// ===== The Fire Stick: connection, remote, RAM, debloat =====
// Same jobs as the PC app's src/ folder, over the phone's own ADB client.

import Foundation
import UIKit

enum Key: Int {
    case up = 19, down = 20, left = 21, right = 22, ok = 23
    case back = 4, home = 3, menu = 82, apps = 187
    case playPause = 85, rewind = 89, forward = 90
    case volUp = 24, volDown = 25, mute = 164
    case sleep = 223, wake = 224
    static let space = 62
}

struct AppMem: Identifiable {
    let pkg: String
    var kb = 0
    var mine = false     // installed by the user (can be stopped)
    var front = false    // on screen now
    var id: String { pkg }
}

struct RamStats {
    var totalKB = 0
    var availKB = 0
    var apps: [AppMem] = []
    var usedKB: Int { max(0, totalKB - availKB) }
    var usedFraction: Double { totalKB > 0 ? Double(usedKB) / Double(totalKB) : 0 }
    var usedPct: Int { Int((usedFraction * 100).rounded()) }
}

@MainActor
final class FireStick: ObservableObject {
    enum Status: Equatable { case disconnected, connecting, waitingForAllow, connected }

    static let versionLabel = "B1.0.0"
    static let projectivyHome = "com.spocky.projengmenu/.ui.home.MainActivity"

    @Published var ip: String = UserDefaults.standard.string(forKey: "ip") ?? ""
    @Published private(set) var status: Status = .disconnected
    @Published var message = ""
    @Published private(set) var ram: RamStats?
    @Published private(set) var freeRamText = ""
    @Published private(set) var debloatText = "Not run yet."
    @Published private(set) var debloatBusy = false
    @Published var autoDebloat: Bool = (UserDefaults.standard.object(forKey: "autoDebloat") as? Bool) ?? true {
        didSet { UserDefaults.standard.set(autoDebloat, forKey: "autoDebloat") }
    }

    private var client: ADBClient?
    private var key: ADBKey?
    private var userDisconnected = false
    private var homeComponent: String?
    private var pendingKeys: [Int] = []
    private var keyWorkerRunning = false
    private var keepAlive: Task<Void, Never>?
    private var ramBusy = false
    private var thirdParty: Set<String> = []
    private var thirdPartyAt = Date.distantPast
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    var isConnected: Bool { status == .connected }

    // MARK: Connection

    func connectIfNeeded() async {
        if status == .disconnected && !userDisconnected && !cleanIp.isEmpty { await connect() }
    }

    private var cleanIp: String {
        ip.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ":5555", with: "")
    }

    func connect() async {
        let host = cleanIp
        guard !host.isEmpty else { message = "Type your Fire Stick's IP in Setup first."; return }
        guard status == .disconnected || status == .connected else { return }
        UserDefaults.standard.set(host, forKey: "ip")
        userDisconnected = false
        keepAlive?.cancel()
        if let old = client { await old.close() }
        client = nil
        status = .connecting
        message = "Connecting to your Fire Stick…"
        do {
            if key == nil { key = try ADBKey.loadOrCreate() }
            let c = ADBClient(host: host)
            try await c.connect(key: key!) { [weak self] in
                Task { @MainActor in
                    self?.status = .waitingForAllow
                    self?.message = "Look at your TV: tick \"Always allow from this computer\" and press Allow."
                }
            }
            client = c
            status = .connected
            message = "Connected."
            startKeepAlive()
            await afterConnect()
        } catch {
            status = .disconnected
            message = "Couldn't connect (\(error.localizedDescription)). Check the IP, that ADB Debugging is on, " +
                "and that FireTvLp may use the Local Network (iPhone Settings → FireTvLp)."
        }
    }

    func disconnect() async {
        userDisconnected = true
        keepAlive?.cancel()
        if let c = client { await c.close() }
        client = nil
        status = .disconnected
        ram = nil
        message = "Disconnected."
    }

    private func lost() {
        guard status == .connected else { return }
        keepAlive?.cancel()
        client = nil
        status = .disconnected
        message = "Lost the Fire Stick. Reconnecting…"
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await connectIfNeeded()
        }
    }

    private func startKeepAlive() {
        keepAlive?.cancel()
        keepAlive = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self, self.status == .connected, !Task.isCancelled else { return }
                if await self.run("echo ok", timeout: 6) == nil { self.lost(); return }
            }
        }
    }

    private func afterConnect() async {
        if let out = await run("pm path com.spocky.projengmenu"), out.contains("package:") {
            homeComponent = Self.projectivyHome
        } else {
            homeComponent = nil
        }
        if autoDebloat { await debloat(reason: "App opened") }
    }

    /// Runs a shell command; nil if it failed.
    @discardableResult
    func run(_ command: String, timeout: TimeInterval = 8) async -> String? {
        guard let c = client, status == .connected else { return nil }
        do {
            return try await c.shell(command, timeout: timeout)
        } catch {
            let open = await c.isOpen
            if !open { lost() }
            return nil
        }
    }

    // MARK: Remote

    /// Presses queue up and go out together ("input keyevent 22 22 22"), so
    /// quick taps aren't each waiting for the last one.
    func press(_ key: Key) {
        haptic.impactOccurred()
        guard isConnected else { return }
        if key == .home, let home = homeComponent {
            Task { await run("am start -a android.intent.action.MAIN -c android.intent.category.HOME -n \(home) >/dev/null 2>&1") }
            return
        }
        pendingKeys.append(key.rawValue)
        if pendingKeys.count > 20 { pendingKeys.removeFirst(pendingKeys.count - 20) }
        guard !keyWorkerRunning else { return }
        keyWorkerRunning = true
        Task {
            while !pendingKeys.isEmpty {
                let batch = pendingKeys
                pendingKeys = []
                await run("input keyevent " + batch.map(String.init).joined(separator: " "))
            }
            keyWorkerRunning = false
        }
    }

    /// Hold OK = long-press (the options menu: move / uninstall).
    func longPressOK() {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        guard isConnected else { return }
        Task { await run("input keyevent --longpress \(Key.ok.rawValue)") }
    }

    /// Types into a Fire TV search box, word by word with Space between.
    func type(_ text: String) {
        guard isConnected else { return }
        let words = text.replacingOccurrences(of: "\n", with: " ").components(separatedBy: " ")
        var parts: [String] = []
        for (i, w) in words.enumerated() {
            if i > 0 { parts.append("input keyevent \(Key.space)") }
            if !w.isEmpty { parts.append("input text '" + w.replacingOccurrences(of: "'", with: "'\\''") + "'") }
        }
        guard !parts.isEmpty else { return }
        Task { await run(parts.joined(separator: "; "), timeout: 20) }
    }

    // MARK: RAM

    func refreshRam() async {
        guard isConnected, !ramBusy else { return }
        ramBusy = true
        defer { ramBusy = false }
        if Date().timeIntervalSince(thirdPartyAt) > 60, let out = await run("cmd package list packages -3 --user 0") {
            thirdParty = Self.packages(in: out)
            thirdPartyAt = Date()
        }
        let sep = "@@SEP@@"
        guard let out = await run("cat /proc/meminfo; echo \(sep); ps -A -o USER,RSS,NAME; echo \(sep); " +
                                  "dumpsys window 2>/dev/null | grep -m1 mCurrentFocus") else { return }
        let parts = out.components(separatedBy: sep)
        guard parts.count >= 3 else { return }

        var mem: [String: Int] = [:]
        for line in parts[0].split(separator: "\n") {
            let f = line.split(whereSeparator: { $0 == ":" || $0 == " " })
            if f.count >= 2, let v = Int(f[1]) { mem[String(f[0])] = v }
        }

        var front = ""
        if let r = parts[2].range(of: #" [A-Za-z][\w.]*/"#, options: .regularExpression) {
            front = parts[2][r].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/", with: "")
        }

        var apps: [String: AppMem] = [:]
        for line in parts[1].split(separator: "\n").dropFirst() {
            let f = line.split(separator: " ", omittingEmptySubsequences: true)
            guard f.count >= 3, let rss = Int(f[1]) else { continue }
            let name = String(f[2])
            guard let first = name.first, first.isLetter, name.contains(".") else { continue }   // package-style names
            let pkg = String(name.split(separator: ":")[0])
            apps[pkg, default: AppMem(pkg: pkg)].kb += rss
        }
        let list = apps.values.map { a -> AppMem in
            var a = a
            a.mine = thirdParty.contains(a.pkg)
            a.front = a.pkg == front
            return a
        }.sorted { $0.kb > $1.kb }

        ram = RamStats(totalKB: mem["MemTotal"] ?? 0, availKB: mem["MemAvailable"] ?? 0, apps: list)
    }

    func freeRam() async {
        freeRamText = "Clearing cached apps…"
        if let r = await killCached() {
            let diff = r.after - r.before
            freeRamText = "Free RAM: \(r.before) MB → \(r.after) MB (\(diff >= 0 ? "+" : "")\(diff) MB)"
        } else {
            freeRamText = "Couldn't clear (Fire Stick not connected?)"
        }
        await refreshRam()
    }

    func stopApp(_ pkg: String) async {
        guard thirdParty.contains(pkg) else { return }     // only apps the user installed
        await run("am force-stop \(pkg)")
        await refreshRam()
    }

    /// am kill-all closes cached background apps (never the one on screen).
    private func killCached() async -> (before: Int, after: Int)? {
        guard let out = await run("grep MemAvailable /proc/meminfo; am kill-all; sleep 2; echo @@; " +
                                  "grep MemAvailable /proc/meminfo", timeout: 12) else { return nil }
        let parts = out.components(separatedBy: "@@")
        guard parts.count == 2 else { return nil }
        return (before: Self.megabytes(in: parts[0]), after: Self.megabytes(in: parts[1]))
    }

    // MARK: Debloat

    /// Turns off the apps on the list that are back on. Apps Fire OS protects
    /// get suspended and blocked from the background instead. Then the RAM
    /// settings (max 8 cached apps, animations off) and a cached-app clear.
    func debloat(reason: String) async {
        guard isConnected, !debloatBusy else { return }
        debloatBusy = true
        defer { debloatBusy = false }
        debloatText = "Debloating…"
        guard let all = await run("cmd package list packages --user 0", timeout: 10),
              let dis = await run("cmd package list packages -d --user 0", timeout: 10) else {
            debloatText = "Couldn't read the app list from the Fire Stick."
            return
        }
        let installed = Self.packages(in: all), disabled = Self.packages(in: dis)
        let list = DebloatList.packages
        let targets = list.filter { installed.contains($0) && !disabled.contains($0) }
        var off = 0, suspended = 0, failed = 0
        if !targets.isEmpty {
            let script = "for p in \(targets.joined(separator: " ")); do " +
                "if cmd package disable-user --user 0 $p >/dev/null 2>&1; then echo \"OK $p\"; " +
                "elif cmd package suspend --user 0 $p >/dev/null 2>&1; then " +
                "cmd appops set $p RUN_IN_BACKGROUND ignore >/dev/null 2>&1; " +
                "cmd appops set $p RUN_ANY_IN_BACKGROUND ignore >/dev/null 2>&1; echo \"SUSP $p\"; " +
                "else echo \"FAIL $p\"; fi; done"
            let out = await run(script, timeout: 90) ?? ""
            for line in out.split(separator: "\n") {
                if line.hasPrefix("OK ") { off += 1 }
                else if line.hasPrefix("SUSP ") { suspended += 1 }
                else if line.hasPrefix("FAIL ") { failed += 1 }
            }
            failed += max(0, targets.count - off - suspended - failed)
        }
        await run("device_config put activity_manager max_cached_processes 8; " +
                  "settings put global window_animation_scale 0; " +
                  "settings put global transition_animation_scale 0; " +
                  "settings put global animator_duration_scale 0", timeout: 10)
        let freed = await killCached()

        let already = list.filter { disabled.contains($0) }.count
        var parts = [off > 0 ? "turned off \(off) app(s)" : "nothing had come back"]
        if suspended > 0 { parts.append("\(suspended) protected app(s) suspended") }
        if already > 0 { parts.append("\(already) already off") }
        if failed > 0 { parts.append("\(failed) couldn't be stopped") }
        if let r = freed { parts.append("free RAM \(r.before) → \(r.after) MB") }
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)
        debloatText = "\(reason) (\(time)): " + parts.joined(separator: ", ") + "."
        await refreshRam()
    }

    // MARK: Parsing helpers

    static func packages(in text: String) -> Set<String> {
        Set(text.split(separator: "\n").compactMap { line -> String? in
            let s = line.trimmingCharacters(in: .whitespaces)
            return s.hasPrefix("package:") ? String(s.dropFirst("package:".count)) : nil
        })
    }

    /// "MemAvailable:   712345 kB" -> 695
    static func megabytes(in text: String) -> Int {
        let digits = text.split(whereSeparator: { !$0.isNumber }).first.map(String.init) ?? "0"
        return (Int(digits) ?? 0) / 1024
    }
}
