import AppKit
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: NSViewController {
    private let titleField = NSTextField(string: "分享笔记")
    private let editor = NSTextView()
    private let status = NSTextField(wrappingLabelWithString: "正在读取你选择分享的内容…")
    private var saveButton: NSButton!
    private var folder: URL?
    private var folderPanel: NSOpenPanel?
    private var loaded = false
    private var cancelled = false
    private let bookmarkKey = "whywork.share.inbox"

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 420))
        preferredContentSize = view.frame.size
        let heading = NSTextField(labelWithString: "保存到 WhyWork 收件箱")
        heading.font = .boldSystemFont(ofSize: 17)
        let hint = NSTextField(wrappingLabelWithString: "将分享内容存为本地笔记。请在 WhyWork「工作工具 → 采集」中监控同一收件箱目录，即可自动入库。")
        hint.textColor = .secondaryLabelColor
        titleField.placeholderString = "笔记标题"
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        editor.isRichText = false
        editor.isEditable = false
        editor.font = .systemFont(ofSize: 13)
        editor.isVerticallyResizable = true
        editor.autoresizingMask = [.width]
        scroll.documentView = editor
        let choose = NSButton(title: "选择收件箱…", target: self, action: #selector(chooseFolder))
        let cancel = NSButton(title: "取消", target: self, action: #selector(cancelShare))
        cancel.keyEquivalent = "\u{1b}"
        saveButton = NSButton(title: "保存", target: self, action: #selector(saveShare))
        saveButton.keyEquivalent = "\r"
        saveButton.isEnabled = false
        let actions = NSStackView(views: [choose, NSView(), cancel, saveButton])
        actions.orientation = .horizontal
        let stack = NSStackView(views: [heading, hint, titleField, scroll, status, actions])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),
            titleField.widthAnchor.constraint(equalTo: stack.widthAnchor),
            hint.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 180),
            status.widthAnchor.constraint(equalTo: stack.widthAnchor),
            actions.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        restoreFolder()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard !loaded else { return }
        loaded = true
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        guard items.count <= 20 else { fail("一次最多分享20项内容"); return }
        var parts: [String] = []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard providers.count <= 20 else { fail("一次最多分享20项附件"); return }
        for item in items {
            if let title = item.attributedTitle?.string, !title.isEmpty { titleField.stringValue = String(title.prefix(200)) }
            if let text = item.attributedContentText?.string, !text.isEmpty { parts.append(text) }
        }
        loadProvider(providers, at: 0, parts: parts)
    }

    private func loadProvider(_ providers: [NSItemProvider], at index: Int, parts: [String]) {
        guard !cancelled else { return }
        guard index < providers.count else {
            let text = parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
            guard !text.isEmpty, text.utf8.count <= 1_000_000 else { fail("分享内容为空或超过1MB"); return }
            editor.string = text
            editor.isEditable = true
            saveButton.isEnabled = true
            showFolder()
            return
        }
        let provider = providers[index]
        let type: String
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) { type = UTType.url.identifier }
        else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) { type = UTType.plainText.identifier }
        else { fail("当前只接收文本和网页链接，请通过 WhyWork 导入文件"); return }
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] value, error in
            DispatchQueue.main.async {
                guard let self, !self.cancelled else { return }
                guard error == nil else { self.fail("无法读取分享内容，请重试"); return }
                var text: String?
                if let url = value as? URL, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { text = url.absoluteString }
                else if let string = value as? String { text = string }
                else if let data = value as? Data, data.count <= 1_000_000 { text = String(data: data, encoding: .utf8) }
                guard let text, text.utf8.count <= 1_000_000 else { self.fail("内容格式不支持或超过1MB"); return }
                self.loadProvider(providers, at: index + 1, parts: parts.contains(text) ? parts : parts + [text])
            }
        }
    }

    @objc private func chooseFolder() {
        guard folderPanel == nil else { return }
        guard let window = view.window else {
            status.stringValue = "分享窗口尚未就绪，请重试。"
            return
        }
        let panel = NSOpenPanel()
        panel.title = "选择 WhyWork 分享收件箱"
        panel.message = "请选择专用收件箱目录，并在 WhyWork 中监控该目录。"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        folderPanel = panel
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            self.folderPanel = nil
            guard !self.cancelled, response == .OK, let url = panel.url else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
                UserDefaults.standard.set(data, forKey: self.bookmarkKey)
                self.folder = url
                self.showFolder()
            } catch { self.fail("无法保存目录授权，请重新选择收件箱") }
        }
    }

    private func restoreFolder() {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return }
        var stale = false
        folder = try? URL(resolvingBookmarkData: data, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
        if stale { folder = nil }
    }

    private func showFolder() {
        status.stringValue = folder.map { "收件箱：\($0.lastPathComponent)" } ?? "保存前请选择本地收件箱目录。"
    }

    private func fail(_ message: String) {
        status.stringValue = message
        saveButton.isEnabled = false
    }

    @objc private func saveShare() {
        guard let folder else { chooseFolder(); return }
        guard !editor.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, editor.string.utf8.count <= 1_000_000 else { status.stringValue = "请输入不超过1MB的内容"; return }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        do {
            let title = String(titleField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
            let markdown = try SharePayload.markdown(title: title.isEmpty ? "分享笔记" : title, body: editor.string)
            let file = folder.appendingPathComponent("share-\(UUID().uuidString).md", isDirectory: false)
            try Data(markdown.utf8).write(to: file, options: .atomic)
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        } catch { status.stringValue = "保存失败，请重新选择可写入的收件箱目录。" }
    }

    @objc private func cancelShare() {
        cancelled = true
        folderPanel?.cancel(nil)
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}
