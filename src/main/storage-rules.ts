import path from 'node:path'
import type { CleanupItem } from '../shared/storage-types'

export interface StorageRule {
  key: string
  relative: string
  category: CleanupItem['category']
  effect: string
  browser?: string
}

/** Owned, narrowly scoped rules. No downloaded rules or arbitrary commands. */
export function storageRules(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv = process.env): StorageRule[] {
  const rule = (key: string, relative: string, category: StorageRule['category'] = 'cache', effect = 'rebuild', browser?: string): StorageRule => ({ key, relative, category, effect, browser })
  const shared = [rule('npm', '.npm/_cacache', 'developer'), rule('yarn', '.yarn/berry/cache', 'developer'), rule('gradle', '.gradle/caches', 'developer'), rule('cargo', '.cargo/registry/cache', 'developer')]
  if (platform === 'darwin') return [...shared,
    rule('chromeCache', 'Library/Caches/Google/Chrome', 'cache', 'rebuild', 'Google Chrome'),
    rule('safariCache', 'Library/Caches/com.apple.Safari', 'cache', 'rebuild', 'Safari'),
    rule('pip', 'Library/Caches/pip', 'developer'), rule('yarn', 'Library/Caches/Yarn', 'developer'),
    rule('homebrew', 'Library/Caches/Homebrew', 'developer'), rule('xcode', 'Library/Developer/Xcode/DerivedData', 'developer'),
    rule('logs', 'Library/Logs', 'logs', 'logs'),
    rule('safariHistory', 'Library/Safari/History.db', 'privacy', 'history', 'Safari'),
    rule('chromeHistory', 'Library/Application Support/Google/Chrome/Default/History', 'privacy', 'history', 'Google Chrome'),
    rule('edgeHistory', 'Library/Application Support/Microsoft Edge/Default/History', 'privacy', 'history', 'Microsoft Edge'),
  ]
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData/Local')
    return [...shared,
      rule('chromeCache', path.join(local, 'Google/Chrome/User Data/Default/Cache'), 'cache', 'rebuild', 'chrome'),
      rule('edgeCache', path.join(local, 'Microsoft/Edge/User Data/Default/Cache'), 'cache', 'rebuild', 'msedge'),
      rule('pip', path.join(local, 'pip/Cache'), 'developer'),
      rule('npm', path.join(local, 'npm-cache/_cacache'), 'developer'),
      rule('chromeHistory', path.join(local, 'Google/Chrome/User Data/Default/History'), 'privacy', 'history', 'chrome'),
      rule('edgeHistory', path.join(local, 'Microsoft/Edge/User Data/Default/History'), 'privacy', 'history', 'msedge')]
  }
  const cache = env.XDG_CACHE_HOME || path.join(home, '.cache')
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config')
  return [...shared,
    rule('pip', path.join(cache, 'pip'), 'developer'), rule('yarn', path.join(cache, 'yarn'), 'developer'),
    rule('chromeCache', path.join(cache, 'google-chrome'), 'cache', 'rebuild', 'chrome'),
    rule('chromeHistory', path.join(config, 'google-chrome/Default/History'), 'privacy', 'history', 'chrome'),
    rule('chromiumHistory', path.join(config, 'chromium/Default/History'), 'privacy', 'history', 'chromium'),
    rule('recent', '.local/share/recently-used.xbel', 'privacy', 'recent')]
}
