# macOS 分享收件箱

扩展接收用户在宿主应用里主动分享的文本和网页链接，允许预览、编辑标题和正文，再保存为本地 Markdown。它不下载网页、不扫描宿主文件或知识库、不发送网络请求。

## 使用流程

1. 安装 WhyWork.app。macOS 若要求启用分享扩展，在系统设置中启用“WhyWork 收件箱”。当前 ad-hoc 开发包已在本机合成宿主验证菜单激活、预览、目录选择、保存和取消；其他宿主兼容性仍需验收。
2. 在 WhyWork「工作工具 → 采集」选择一个专用目录，例如文稿目录下单独创建的收件箱。该目录不能是知识库内部，也不能包含知识库，以免循环导入。
3. 从支持 macOS 分享菜单的应用分享文本或网页链接到“WhyWork 收件箱”。首次使用选择与第2步相同的目录。
4. 核对预览后保存。扩展只向该目录写入一个新文件；WhyWork 运行时自动导入，未运行时下次启动补扫。暂停/恢复和立即扫描可在采集页操作。

取消分享不会写入文件。目录授权失效或写入失败会留在扩展中提示重选；一次最多20项、正文最多1MB。图片/文件分享暂不支持，请使用主应用文件导入。已有笔记不会因移除监控而删除。

## 构建及权限

- `npm run build:share` 使用 Xcode 的 Swift/AppKit 编译 `native/share`，输出原生 `.appex`；`dist:mac` 会嵌入应用的 `Contents/PlugIns` 并对外层应用重新签名。
- 仅声明 App Sandbox、用户选择目录读写和 app-scope 安全书签；不声明网络访问、App Group、全盘访问或辅助功能权限。
- `npm run check:share` 验证原生 Markdown 载荷的 Unicode、引号和换行；核心隔离检查验证主应用导入这个格式。上述检查不启动系统宿主，不替代分享菜单端到端验收。
- 分发包目前使用 ad-hoc 签名，没有 Apple Developer ID、公证或 App Store 审核。

接口依据：[Apple 分享扩展指南](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)、[扩展 Info.plist 键](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/AppExtensionKeys.html)、[NSOpenPanel](https://developer.apple.com/documentation/appkit/nsopenpanel)。

## 本机合成实测（2026-10-15）

系统分享菜单 → WhyWork 收件箱 → 中文标题编辑 → 选择专用合成目录 → 保存 → 返回宿主已实际执行；磁盘回读标题、正文一致。再次分享保留目录，取消不新增文件。实测发现独立目录面板无法激活，已改为附着分享窗口的sheet，且避免重复打开。主应用完整界面链路随后已验证：启用同一专用目录后，首次扫描入库；监控开启时从系统分享菜单再保存合成文本，无手动扫描即自动出现，打开正文一致。此证据仅覆盖本机合成宿主及文本分享，不扩大为所有宿主或附件格式兼容结论。
