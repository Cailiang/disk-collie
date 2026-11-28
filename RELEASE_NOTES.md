## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/DiskCollie-1.0.38-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.38/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

本版本尚未公开发布，GitHub 下载地址将在发布后可用。本地测试包已签名，未公证。 / This version is not yet published. Local test packages are signed and not notarized.

## 1.0.38 更新 / What's new

- 修复空间分析删除项目目录被 `.env`、配置副本或证书文件误拦截的问题；删除确认会说明这些文件一并移动。
- 真正受保护的内容会显示具体拦截路径和原因，继续保护系统、凭据目录与忽略项。
- Fix whole-folder Trash rejecting projects with `.env`, configuration copies or certificates; explain their inclusion in the review.
- Show the precise blocking path and reason while retaining system, credential-store and ignore-list boundaries.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
