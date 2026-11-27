## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/DiskCollie-1.0.27-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.27/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

macOS 安装包已完成 Developer ID 签名、公证与票据装订。 / macOS packages are Developer ID signed, notarized and stapled.

## 1.0.27 更新 / What's new

- 修复项目目录因包含 Electron 依赖或构建产出的 `.app` 而无法移到废纸篓的问题，继续执行完整核对与路径保护。
- 空间分析移除重复的右下角操作区，打开位置、询问 AI 和删除统一在目录树中操作。
- 终端页统一三款小游戏与扫描布局；游戏随窗口和全屏大小伸展，缩放后保留本局进度。
- Reviewed project folders can include uninstalled application build outputs and dependency runtimes when moved to Trash.
- Space explorer keeps actions in directory rows and removes its duplicate selected-item panel.
- Terminal shares the same three-game scan layout; all scan games expand for fullscreen windows while retaining the round across resizing.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
