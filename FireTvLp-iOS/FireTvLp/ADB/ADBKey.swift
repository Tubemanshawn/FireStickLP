// ===== This phone's ADB key =====
// The Fire Stick only accepts ADB clients whose RSA key the user allowed on
// the TV ("Allow USB debugging?"). The phone makes one 2048-bit key on first
// run, keeps it in the app's files, and:
//   - signs the Fire Stick's 20-byte challenge with it (PKCS#1 v1.5, SHA-1), and
//   - sends the public key in Android's own format when it isn't known yet.

import Foundation
import Security

final class ADBKey {
    let privateKey: SecKey
    /// Public key as adbd wants it: base64(Android RSAPublicKey) + " name" + NUL.
    let publicKeyPayload: Data

    init(privateKey: SecKey) throws {
        self.privateKey = privateKey
        guard let pub = SecKeyCopyPublicKey(privateKey) else { throw ADBError.failed("no public key") }
        var err: Unmanaged<CFError>?
        guard let der = SecKeyCopyExternalRepresentation(pub, &err) as Data? else {
            throw ADBKey.error(err, "couldn't read the public key")
        }
        let android = try ADBKey.androidPublicKey(fromPKCS1: [UInt8](der))
        publicKeyPayload = Data((android.base64EncodedString() + " FireTvLp@iPhone").utf8) + Data([0])
    }

    static func loadOrCreate() throws -> ADBKey {
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: true)
        let file = dir.appendingPathComponent("adbkey.der")
        let loadAttrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: 2048,
        ]
        if let data = try? Data(contentsOf: file),
           let key = SecKeyCreateWithData(data as CFData, loadAttrs as CFDictionary, nil) {
            return try ADBKey(privateKey: key)
        }
        var err: Unmanaged<CFError>?
        let genAttrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
        ]
        guard let key = SecKeyCreateRandomKey(genAttrs as CFDictionary, &err) else {
            throw error(err, "couldn't make a key")
        }
        guard let data = SecKeyCopyExternalRepresentation(key, &err) as Data? else {
            throw error(err, "couldn't save the key")
        }
        try data.write(to: file, options: .atomic)
        return try ADBKey(privateKey: key)
    }

    /// Signs the Fire Stick's challenge token (treated as a SHA-1 digest, like adb does).
    func sign(_ token: Data) throws -> Data {
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(privateKey, .rsaSignatureDigestPKCS1v15SHA1,
                                              token as CFData, &err) as Data? else {
            throw ADBKey.error(err, "couldn't sign in")
        }
        return sig
    }

    private static func error(_ err: Unmanaged<CFError>?, _ msg: String) -> Error {
        if let e = err?.takeRetainedValue() { return e as Error }
        return ADBError.failed(msg)
    }

    // MARK: Android public key format
    // struct { u32 len (=64 words); u32 n0inv; u32 n[64]; u32 rr[64]; u32 exponent }
    // little-endian words, n0inv = -1/n mod 2^32, rr = (2^2048)^2 mod n.

    static func androidPublicKey(fromPKCS1 der: [UInt8]) throws -> Data {
        let bad = ADBError.failed("unexpected key format")
        var i = 0
        func readLength() throws -> Int {
            guard i < der.count else { throw bad }
            let b = Int(der[i]); i += 1
            if b < 0x80 { return b }
            var len = 0
            for _ in 0..<(b & 0x7f) {
                guard i < der.count else { throw bad }
                len = (len << 8) | Int(der[i]); i += 1
            }
            return len
        }
        func readInteger() throws -> [UInt8] {
            guard i < der.count, der[i] == 0x02 else { throw bad }
            i += 1
            let len = try readLength()
            guard i + len <= der.count else { throw bad }
            var v = Array(der[i..<(i + len)])
            i += len
            while v.count > 1 && v[0] == 0 { v.removeFirst() }
            return v
        }
        guard der.first == 0x30 else { throw bad }       // SEQUENCE { modulus, exponent }
        i = 1
        _ = try readLength()
        let modulus = try readInteger()
        let exponentBytes = try readInteger()
        guard modulus.count <= 256 else { throw bad }

        let words = 64
        let nb = [UInt8](repeating: 0, count: 256 - modulus.count) + modulus
        var n = [UInt32](repeating: 0, count: words)       // n[0] = least significant word
        for k in 0..<words {
            let o = 256 - 4 * (k + 1)
            n[k] = (UInt32(nb[o]) << 24) | (UInt32(nb[o + 1]) << 16) | (UInt32(nb[o + 2]) << 8) | UInt32(nb[o + 3])
        }

        // n0inv: Newton's method for the inverse of n[0] mod 2^32, then negate.
        let a = n[0]
        var x = a
        for _ in 0..<5 { x = x &* (2 &- a &* x) }
        let n0inv = 0 &- x

        // rr = 2^4096 mod n, by doubling 4096 times.
        var r = [UInt32](repeating: 0, count: words)
        r[0] = 1
        for _ in 0..<(2 * 32 * words) {
            let carry = r[words - 1] >> 31
            var k = words - 1
            while k > 0 { r[k] = (r[k] << 1) | (r[k - 1] >> 31); k -= 1 }
            r[0] <<= 1
            if carry == 1 || !isLess(r, n) { subtract(&r, n) }
        }

        var exponent: UInt32 = 0
        for b in exponentBytes { exponent = (exponent << 8) | UInt32(b) }

        var out = Data()
        out.append(contentsOf: littleEndianBytes(UInt32(words)))
        out.append(contentsOf: littleEndianBytes(n0inv))
        for w in n { out.append(contentsOf: littleEndianBytes(w)) }
        for w in r { out.append(contentsOf: littleEndianBytes(w)) }
        out.append(contentsOf: littleEndianBytes(exponent))
        return out
    }

    private static func isLess(_ a: [UInt32], _ b: [UInt32]) -> Bool {
        var k = a.count - 1
        while k >= 0 {
            if a[k] != b[k] { return a[k] < b[k] }
            k -= 1
        }
        return false
    }

    private static func subtract(_ a: inout [UInt32], _ b: [UInt32]) {
        var borrow: Int64 = 0
        for k in 0..<a.count {
            var d = Int64(a[k]) - Int64(b[k]) - borrow
            if d < 0 { d += 1 << 32; borrow = 1 } else { borrow = 0 }
            a[k] = UInt32(d)
        }
    }
}
