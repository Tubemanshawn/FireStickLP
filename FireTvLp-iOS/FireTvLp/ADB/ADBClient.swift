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
        var keepOutput = true                                 // false for long-lived streams
        var closed = false
        var waiter: CheckedContinuation<Data, Error>?         // shell(): output at close
        var openWaiter: CheckedContinuation<Void, Error>?     // openStream(): first OKAY
        var ackWaiter: CheckedContinuation<Void, Error>?      // write(): OKAY for our WRTE
        var earlyAcks = 0                                     // OKAYs that beat their waiter
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

    // MARK: Long-lived streams (the fast remote: monkey)

    /// Opens a service ("shell:monkey --port 1080", "tcp:1080") and keeps it open.
    func openStream(_ service: String, timeout: TimeInterval = 5) async throws -> UInt32 {
        guard isOpen else { throw ADBError.notConnected }
        let id = nextId
        nextId &+= 1
        var st = StreamState()
        st.keepOutput = false
        streams[id] = st
        try await send(ADBMessage(command: ADBMessage.OPEN, arg0: id, arg1: 0, payload: .cString(service)))
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            await self?.failOpen(id)
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            guard let s = streams[id] else { cont.resume(throwing: ADBError.closed); return }
            if s.closed { streams[id] = nil; cont.resume(throwing: ADBError.closed) }
            else if s.remoteId != 0 { cont.resume() }
            else { streams[id]?.openWaiter = cont }
        }
        return id
    }

    /// Sends data on an open stream and waits for the Fire Stick's OKAY.
    func write(_ id: UInt32, _ data: Data, timeout: TimeInterval = 3) async throws {
        guard let s = streams[id], s.remoteId != 0, !s.closed else { throw ADBError.closed }
        try await send(ADBMessage(command: ADBMessage.WRTE, arg0: id, arg1: s.remoteId, payload: data))
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            await self?.failAck(id)
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            guard let s = streams[id], !s.closed else { cont.resume(throwing: ADBError.closed); return }
            if s.earlyAcks > 0 { streams[id]?.earlyAcks -= 1; cont.resume() }
            else { streams[id]?.ackWaiter = cont }
        }
    }

    func isStreamOpen(_ id: UInt32) -> Bool {
        guard let s = streams[id] else { return false }
        return !s.closed && s.remoteId != 0
    }

    func closeStream(_ id: UInt32) async {
        guard let s = streams[id] else { return }
        streams[id] = nil
        s.openWaiter?.resume(throwing: ADBError.closed)
        s.ackWaiter?.resume(throwing: ADBError.closed)
        s.waiter?.resume(returning: s.output)
        if s.remoteId != 0 && !s.closed {
            try? await send(ADBMessage(command: ADBMessage.CLSE, arg0: id, arg1: s.remoteId, payload: Data()))
        }
    }

    private func failOpen(_ id: UInt32) {
        guard let w = streams[id]?.openWaiter else { return }
        streams[id] = nil
        w.resume(throwing: ADBError.timeout)
    }

    private func failAck(_ id: UInt32) {
        guard let w = streams[id]?.ackWaiter else { return }
        streams[id]?.ackWaiter = nil
        w.resume(throwing: ADBError.timeout)
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
            guard var s = streams[local] else { return }
            if s.remoteId == 0 {                    // stream accepted
                s.remoteId = remote
                let w = s.openWaiter
                s.openWaiter = nil
                streams[local] = s
                w?.resume()
            } else if let w = s.ackWaiter {         // our WRTE was received
                s.ackWaiter = nil
                streams[local] = s
                w.resume()
            } else {
                s.earlyAcks += 1
                streams[local] = s
            }
        case ADBMessage.WRTE:
            guard let s = streams[local] else { return }
            if s.keepOutput { streams[local]?.output.append(m.payload) }
            try await send(ADBMessage(command: ADBMessage.OKAY, arg0: local, arg1: remote, payload: Data()))
        case ADBMessage.CLSE:
            finish(local)
        default:
            break
        }
    }

    private func finish(_ id: UInt32, error: Error? = nil) {
        guard var s = streams[id] else { return }
        // Wake anyone waiting to open or write on this stream.
        s.openWaiter?.resume(throwing: error ?? ADBError.closed)
        s.openWaiter = nil
        s.ackWaiter?.resume(throwing: error ?? ADBError.closed)
        s.ackWaiter = nil
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
