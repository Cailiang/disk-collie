import { configDefaults, defineConfig } from 'vitest/config'

// These retained macOS maintenance modules are not used by the portable storage adapter.
const macMaintenanceTests = [
  'src/main/application-trash.test.ts',
  'src/main/brew-cleanup.test.ts',
  'src/main/disk-usage-scanner.test.ts',
  'src/main/home-hidden-cleanup.test.ts',
  'src/main/privileged-cleanup.test.ts',
  'src/main/scanner-shell.test.ts',
  'src/main/service-cleanup.test.ts'
]

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...(process.platform === 'win32' ? macMaintenanceTests : [])]
  }
})
