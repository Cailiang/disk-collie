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

macOS 安装包已签名并公证。 / macOS packages are signed and notarized.

## 1.0.34 更新 / What's new

- 新增“启动项优化”：按应用查看启用、禁用和残留项目，支持搜索、启停、移除启动配置与操作记录。
- 显示软件的本地化名称，修复 null、状态说明及删除时列表过期的问题。
- macOS 同批受保护配置合并请求一次管理员授权；删除后只核验相关项目，避免额外的 System Events／sfltool 扫描授权。
- 每次启动优先从 GitHub 检查更新，网络不可用时切换到 diskcollie.app 官网数据源。
- Add Startup optimization with grouped applications, status/leftover filters, enable/disable, registration-only removal and local operation history.
- Show localized app names and fix null metadata, unavailable-state explanations and expired selections.
- Share one macOS administrator authorization per protected batch and verify affected registrations without unrelated System Events/sfltool scans.
- Check GitHub for updates on every launch and use diskcollie.app when GitHub cannot be reached.

[完整更新记录 / Full changelog](https://github.com/Cailiang/disk-collie/blob/main/CHANGELOG.md)
