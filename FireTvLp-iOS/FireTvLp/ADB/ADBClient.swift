// ===== ADB over Wi-Fi, written from scratch =====
// iPhones can't run Google's adb, so this speaks the ADB network protocol
// directly to the Fire Stick (port 5555), the same protocol the PC's adb uses.
//
// Messages: a 24-byte header (command, arg0, arg1, payload length, payload
// checksum, command ^ 0xffffffff), all little-endian, then the payload.
//   CNXN  hello                       AUTH  RSA sign-in (see ADBKey.swift)
//   OPEN  start a service ("shell:…")  OKAY  ready / got your data
//   WRTE  data                        CLSE  stream closed

import Foundation
import Network

enum ADBError: LocalizedError {
    case closed, timeout, notConnected, failed(String)

    var errorDescription: String? {
        switch self {
        case .closed: return "the connection closed"
        case .timeout: return "the Fire Stick didn't answer in time"
        case .notConnected: return "not connected"
        case .failed(let s): return s
        }
    }
}

struct ADBMessage {
    static let CNXN: UInt32 = 0x4e58_4e43
    static let AUTH: UInt32 = 0x4854_5541
    static let OPEN: UInt32 = 0x4e45_504f
    static let OKAY: UInt32 = 0x5941_4b4f
    static let CLSE: UInt32 = 0x4553_4c43
    static let WRTE: UInt32 = 0x4554_5257

    var command: UInt32
    var arg0: UInt32
    var arg1: UInt32
    var payload: Data

    func encoded() -> Data {
        var out = Data(capacity: 24 + payload.count)
        let checksum = payload.reduce(UInt32(0)) { $0 &+ UInt32($1) }
        for v in [command, arg0, arg1, UInt32(payload.count), checksum, command ^ 0xffff_ffff] {
            out.append(contentsOf: littleEndianBytes(v))
        }
        out.append(payload)
        return out
    }

    static func u32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) | (UInt32(b[i + 1]) << 8) | (UInt32(b[i + 2]) << 16) | (UInt32(b[i + 3]) << 24)
    }
}

func littleEndianBytes(_ v: UInt32) -> [UInt8] {
    [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)]
}

extension Data {
    /// UTF-8 bytes plus a trailing zero, as ADB expects for service names.
    static func cString(_ s: String) -> Data { Data(s.utf8) + Data([0]) }
}

/// Runs a closure only once, from any thread.
final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ f: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        if !done { done = true; f() }
    }
}

/// A movable time limit for the sign-in (longer while the TV shows "Allow?").
final class Deadline: @unchecked Sendable {
    private let lock = NSLock()
    private var until = Date.distantFuture
    private var finished = false
    func extend(_ seconds: TimeInterval) { lock.lock(); until = Date().addingTimeInterval(seconds); lock.unlock() }
    func finish() { lock.lock(); finished = true; lock.unlock() }
    var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return finished }
    var isExpired: Bool { lock.lock(); defer { lock.unlock() }; return Date() > until }
}

actor ADBClient {
    private let conn: NWConnection
    private var nextId: UInt32 = 1
    private var streams: [UInt32: StreamState] = [:]
    private(set) var isOpen = false

    private struct StreamState {
        var remoteId: UInt32 = 0
        var output = Data()
        var closed = false
        var waiter: CheckedContinuation<Data, Error>?
    }

    init(host: String, port: UInt16 = 5555) {
        conn = NWConnection(host: NWEndpoint.Host(host),
                            port: NWEndpoint.Port(rawValue: port) ?? 5555,
                            using: .tcp)
    }

    // MARK: Connect + sign in

    /// Opens the connection and signs in. `onAllowPrompt` runs when the TV is
    /// showing "Allow USB debugging?" for this phone (first time only).
    func connect(key: ADBKey, onAllowPrompt: @escaping @Sendable () -> Void) async throws {
        let c = conn
        let deadline = Deadline()
        deadline.extend(12)
        Task.detached {
            while !deadline.isFinished {
                try? await Task.sleep(nanoseconds: 500_000_000)
                if deadline.isExpired && !deadline.isFinished { c.cancel(); return }
            }
        }
        defer { deadline.finish() }

        try await startConnection()
        try await send(ADBMessage(command: ADBMessage.CNXN, arg0: 0x0100_0000, arg1: 256 * 1024,
                                  payload: .cString("host::FireTvLp")))
        var signed = false
        while true {
            let m = try await readMessage()
            switch m.command {
            case ADBMessage.CNXN:
                isOpen = true
                Task { await self.readLoop() }
                return
            case ADBMessage.AUTH where m.arg0 == 1:            // TOKEN: prove who we are
                if !signed {
                    signed = true                              // 1st try: sign with our key
                    let sig = try key.sign(m.payload)
                    try await send(ADBMessage(command: ADBMessage.AUTH, arg0: 2, arg1: 0, payload: sig))
                } else {
                    // Key not known yet: send it; the TV asks the user to allow it.
                    try await send(ADBMessage(command: ADBMessage.AUTH, arg0: 3, arg1: 0, payload: key.publicKeyPayload))
                    deadline.extend(90)
                    onAllowPrompt()
                }
            default:
                continue
            }
        }
    }

    private func startConnection() async throws {
        let c = conn
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let once = Once()
            c.stateUpdateHandler = { state in
                switch state {
                case .ready: once.run { cont.resume() }
                case .failed(let e): once.run { cont.resume(throwing: e) }
                case .cancelled: once.run { cont.resume(throwing: ADBError.timeout) }
                default: break     // .waiting (e.g. Local Network prompt): keep waiting until the deadline
                }
            }
            c.start(queue: DispatchQueue(label: "adb.connection"))
        }
    }

    // MARK: Shell commands

    /// Runs a shell command on the Fire Stick and returns its output.
    func shell(_ command: String, timeout: TimeInterval = 8) async throws -> String {
        guard isOpen else { throw ADBError.notConnected }
        let id = nextId
        nextId &+= 1
        streams[id] = StreamState()
        try await send(ADBMessage(command: ADBMessage.OPEN, arg0: id, arg1: 0, payload: .cString("shell:" + command)))
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            await self?.finish(id, error: ADBError.timeout)
        }
        let data: Data = try await withCheckedThrowingContinuation { cont in
            if let s = streams[id], s.closed {
                streams[id] = nil
                cont.resume(returning: s.output)
            } else if streams[id] == nil {
                cont.resume(throwing: ADBError.closed)
            } else {
                streams[id]?.waiter = cont
            }
        }
        return String(decoding: data, as: UTF8.self).replacingOccurrences(of: "\r\n", with: "\n")
    }

    func close() { shutdown() }

    // MARK: Reading

    private func readLoop() async {
        do {
            while true { try await handle(readMessage()) }
        } catch {
            shutdown()
        }
    }

    private func handle(_ m: ADBMessage) async throws {
        let remote = m.arg0, local = m.arg1
        switch m.command {
        case ADBMessage.OKAY:
            streams[local]?.remoteId = remote
        case ADBMessage.WRTE:
            guard streams[local] != nil else { return }
            streams[local]?.output.append(m.payload)
            try await send(ADBMessage(command: ADBMessage.OKAY, arg0: local, arg1: remote, payload: Data()))
        case ADBMessage.CLSE:
            finish(local)
        default:
            break
        }
    }

    private func finish(_ id: UInt32, error: Error? = nil) {
        guard var s = streams[id] else { return }
        if let w = s.waiter {
            streams[id] = nil
            if let error, s.output.isEmpty { w.resume(throwing: error) } else { w.resume(returning: s.output) }
        } else {
            s.closed = true
            streams[id] = s
        }
    }

    private func shutdown() {
        isOpen = false
        conn.cancel()
        for id in Array(streams.keys) { finish(id, error: ADBError.closed) }
    }

    // MARK: Low level

    private func receive(_ n: Int) async throws -> Data {
        if n == 0 { return Data() }
        let c = conn
        return try await withCheckedThrowingContinuation { cont in
            c.receive(minimumIncompleteLength: n, maximumLength: n) { data, _, _, error in
                if let error { cont.resume(throwing: error) }
                else if let data, data.count == n { cont.resume(returning: data) }
                else { cont.resume(throwing: ADBError.closed) }
            }
        }
    }

    private func readMessage() async throws -> ADBMessage {
        let h = [UInt8](try await receive(24))
        let length = Int(ADBMessage.u32(h, 12))
        guard length <= 4 * 1024 * 1024 else { throw ADBError.failed("bad data from the Fire Stick") }
        let payload = try await receive(length)
        return ADBMessage(command: ADBMessage.u32(h, 0), arg0: ADBMessage.u32(h, 4),
                          arg1: ADBMessage.u32(h, 8), payload: payload)
    }

    private func send(_ m: ADBMessage) async throws {
        let c = conn
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            c.send(content: m.encoded(), completion: .contentProcessed { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            })
        }
    }
}
