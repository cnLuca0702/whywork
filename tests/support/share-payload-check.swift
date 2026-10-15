import Foundation
@main struct SharePayloadCheck {
    static func main() throws {
        let title = "合成\"标题\n第二行: 安全"
        let body = "SHARE_SYNTHETIC_MARKER\nhttps://example.invalid/\n---\n正文"
        let markdown = try SharePayload.markdown(title: title, body: body)
        let lines = markdown.components(separatedBy: "\n")
        let encodedTitle = String(lines[1].dropFirst("title: ".count))
        let decoded = try JSONSerialization.jsonObject(with: Data(encodedTitle.utf8), options: .fragmentsAllowed) as? String
        precondition(decoded == title)
        precondition(markdown.hasSuffix(body + "\n"))
        precondition(lines[3] == "---")
        print("[SHARE-PAYLOAD-CHECK] Unicode/quoted/multiline title and body preserved; no host UI tested")
    }
}
