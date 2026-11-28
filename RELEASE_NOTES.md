## 下载 / Downloads

| 平台 / Platform | 架构 / Architecture | 安装包 / Installer |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-arm64.dmg) |
| macOS | Intel / x64 | [下载 DMG / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-x64.dmg) |
| Windows | x64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-x64.exe) |
| Windows | arm64 | [下载 EXE / Download](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-arm64.exe) |
| Linux | x64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-x86_64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-amd64.deb) |
| Linux | arm64 | [AppImage](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-arm64.AppImage) · [DEB](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/DiskCollie-1.0.34-arm64.deb) |

[SHA-256 校验和 / Checksums](https://github.com/Cailiang/disk-collie/releases/download/v1.0.34/SHA256SUMS.txt) · [产品截图 / Screenshots](https://github.com/Cailiang/disk-collie#your-device-at-a-glance)

本版本尚未公开发布，GitHub 下载地址将在发布后可用。本地测试安装包已签名，未公证。 / This version has not been published; GitHub downloads become available after publication. Local test packages are signed and not notarized.

## 1.0.34 更新 / What's new

- macOS 同批受保护启动配置合并请求一次管理员授权；取消授权则不修改该批配置。
- 删除残留后只核验相关项目，避免完整重扫再次触发 System Events／sfltool 授权。
- 保留逐项结果、配置变化检查和原生状态核验；后续新的管理员操作仍可能需要系统授权。
- Selected macOS machine startup configurations share one administrator authorization per operation.
- Verify affected registrations directly after changes, avoiding unrelated System Events/sfltool scans while retaining per-item results and native verification.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
