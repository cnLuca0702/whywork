import Foundation

enum SharePayload {
    static func markdown(title: String, body: String) throws -> String {
        let quoted = try JSONSerialization.data(withJSONObject: title, options: [.fragmentsAllowed])
        return "---\ntitle: \(String(decoding: quoted, as: UTF8.self))\nsource: manual\n---\n\n\(body)\n"
    }
}
