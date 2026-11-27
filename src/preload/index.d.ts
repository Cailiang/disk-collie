import type { DiskCollieApi } from '../shared/types'

declare global {
  interface Window {
    diskCollie?: DiskCollieApi
  }
}

export {}
