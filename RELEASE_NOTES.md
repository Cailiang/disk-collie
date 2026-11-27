## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/DiskCollie-1.0.29-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.29/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

macOS 安装包已完成 Developer ID 签名、公证与票据装订。 / macOS packages are Developer ID signed, notarized and stapled.

## 1.0.29 更新 / What's new

- 修复含真实 ASAR 归档的项目目录被误判为受保护内容、无法移到废纸篓的问题。
- Fix project-folder removal when Electron ASAR archives are present.

- 删除“深度清理”板块，首页直接进入大文件。
- 应用管理显示 DiskCollie 自身，保留自身保护。
- 优化 Windows 大文件扫描：批量读取目录信息，减少小文件逐个打开；保留空间统计和删除前核验。
- 修复项目目录包含构建产物时无法移到废纸篓的问题，空间分析操作统一在目录树中完成。
- 统一终端扫描布局与三款小游戏，适配窗口和全屏大小。
- Remove Deep cleanup and link Overview directly to Large files.
- Show DiskCollie in Application manager with self-protection.
- Batch Windows directory metadata during large-file discovery, preserving totals and mutation validation.
- Fix reviewed project-folder removal with bundled build outputs; keep Space explorer actions in directory rows.
- Unify Terminal’s three-game scan layout and fit games to window and fullscreen sizes.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
