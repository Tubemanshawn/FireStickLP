// ===== Dots added for you while typing an IP address =====
// A part of the address is finished, so a dot is added, when it can't grow
// any more: 3 digits, a number over 25 (26x would pass 255), or a lone 0.
//   typing 1921680184  ->  192.168.0.184
// Typing "." yourself still works (an extra one after an added dot is
// ignored), and nothing is added while deleting.
// Same rules as formatIp() in the PC apps' renderer.js.

enum IPFormatter {
    static func format(old: String, new: String) -> String {
        let cleaned = new.filter { $0.isNumber || $0 == "." }
        guard cleaned.count > old.count else { return cleaned }      // deleting: leave it

        var out = "", part = "", parts = 0
        for ch in cleaned {
            if ch == "." {
                if part.isEmpty || parts == 3 { continue }            // double dot / no 5th part
                out += part + "."
                part = ""
                parts += 1
            } else {
                if parts == 3 && part.count == 3 { continue }         // address is full
                part.append(ch)
                if parts < 3 && isFinished(part) {
                    out += part + "."
                    part = ""
                    parts += 1
                }
            }
        }
        return out + part
    }

    private static func isFinished(_ part: String) -> Bool {
        part.count >= 3 || part == "0" || (Int(part) ?? 0) > 25
    }
}
