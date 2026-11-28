## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/DiskCollie-1.0.40-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.40/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

macOS 安装包已使用 Developer ID 签名并通过 Apple 公证。 / macOS installers are Developer ID signed and notarized.

## 1.0.40 更新 / What's new

- 修复空间分析删除项目被 `.env` 配置误拦截的问题，支持核验后移走第三方应用数据；明确管理员授权内容。
- 文件结果提供忽略和属性查看；启动项可按单项或整组忽略，重扫、重启后保留，并可恢复。
- 模型用途说明收进帮助，两个导入按钮直接展示；设置入口统一到侧栏底部。
- 修复应用管理“询问 AI”要求先体检的问题，单项解读直接使用所选信息。
- Verify native path formats and protected roots on Windows and macOS.
- Fix project-folder Trash blocked by `.env` files, review third-party application data, and clarify administrator authorization.
- Add file ignores/properties and persistent, restorable startup ignores.
- Simplify model settings, expose import buttons and keep one Settings entry.
- Explain individual applications and files without a health scan prerequisite.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
