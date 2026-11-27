/// <reference types="vite/client" />

import type { DiskCollieApi } from '../../shared/types'

declare global {
  const __DISKCOLLIE_VERSION__: string

  interface Window {
    diskCollie?: DiskCollieApi
  }
}

export {}
