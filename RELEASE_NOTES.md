## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/DiskCollie-1.0.32-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.32/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

本版本尚未公开发布，GitHub 下载地址将在发布后可用。本地测试安装包已签名，未公证。 / This version has not been published; GitHub downloads become available after publication. Local test packages are signed and not notarized.

## 1.0.32 更新 / What's new

- 修复启动项中的 null 占位值，减少无注册证据的“状态未知”项目，并说明系统状态读取限制。
- 修复页面停留或重扫描后删除启动项时报列表过期，继续保留操作前后的原生核验。
- 启动自动检查更新；GitHub 无法访问时回退官网的版本、更新清单与已校验安装包镜像。
- Fix startup metadata placeholders, speculative helper entries and selections expiring after idle time or read-only rescans.
- Prefer GitHub for launch/hourly updates, with the official website supplying verified metadata and payloads when GitHub access fails.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
