import type { AppUpdateState } from '../shared/types'

const LATEST_RELEASE_ENDPOINT = 'https://api.github.com/repos/Cailiang/disk-collie/releases/latest'
export const WEBSITE_RELEASE_ENDPOINT='https://diskcollie.app/releases/latest.json'
export const WEBSITE_UPDATE_FEED='https://diskcollie.app/updates'
export type UpdateSource='github'|'website'

interface GitHubRelease {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
}

type FetchProvider = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export type AppUpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; checkedAt?: string }
  | { type: 'not-available'; version: string; checkedAt?: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'installing' }
  | { type: 'error'; message: string; checkedAt?: string }
  | { type: 'unsupported' }

export function createUpdateState(currentVersion: string): AppUpdateState {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    phase: 'idle',
    downloadPercent: null,
    checkedAt: null,
    error: null
  }
}

function boundedPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

function versionParts(value: string): number[] | null {
  const normalized = value.trim().replace(/^v/i, '').split('-')[0]
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return null
  return normalized.split('.').map(Number)
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = versionParts(latest)
  const currentParts = versionParts(current)
  if (!latestParts || !currentParts) return false
  const length = Math.max(latestParts.length, currentParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (latestParts[index] ?? 0) - (currentParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

export function isMissingUpdateManifestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /cannot find latest(?:-[^\s]*)?\.yml/i.test(message) ||
    (/latest(?:-(?:mac|linux|linux-arm64))?\.yml/i.test(message) && /\b404\b/.test(message))
}

export async function fetchLatestReleaseVersion(
  currentVersion: string,
  fetchProvider: FetchProvider = fetch,
  timeoutMs = 10_000
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchProvider(LATEST_RELEASE_ENDPOINT, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `DiskCollie/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })
    // A newly created repository has no published version yet.
    if(response.status===404)return currentVersion
    if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`)
    const release = await response.json() as GitHubRelease
    const latestVersion = typeof release.tag_name === 'string'
      ? release.tag_name.trim().replace(/^v/i, '')
      : ''
    if (!versionParts(latestVersion) || release.draft === true || release.prerelease === true) {
      throw new Error('GitHub Releases returned invalid stable release metadata')
    }
    return latestVersion
  } finally {
    clearTimeout(timeout)
  }
}

async function websiteReleaseVersion(currentVersion:string,fetchProvider:FetchProvider,timeoutMs:number):Promise<string>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs)
  try{
    const response=await fetchProvider(WEBSITE_RELEASE_ENDPOINT,{headers:{Accept:'application/json','User-Agent':`DiskCollie/${currentVersion}`},signal:controller.signal})
    if(!response.ok)throw new Error(`Website Releases HTTP ${response.status}`)
    const release=await response.json() as {repository?:unknown;version?:unknown;tag?:unknown}
    if(release.repository!=='Cailiang/disk-collie'||typeof release.version!=='string'||!/^\d+\.\d+\.\d+$/.test(release.version)||release.tag!==`v${release.version}`)throw new Error('Website returned invalid stable release metadata')
    return release.version
  }finally{clearTimeout(timeout)}
}

export function isUpdateSourceUnavailable(error:unknown):boolean{
  let candidate=error
  for(let depth=0;candidate&&depth<5;depth++){
    const value=candidate as Error&{code?:string;cause?:unknown},text=String(candidate)+' '+(value.code||'')
    if(value.name==='AbortError'||value.name==='TimeoutError'||
      /HTTP|HttpError|status|response/i.test(text)&&/\b(?:403|408|429|5\d\d)\b/.test(text)||
      /\b(?:ENOTFOUND|EAI_AGAIN|ECONN\w*|ETIMEDOUT|UND_ERR_(?:SOCKET|\w*TIMEOUT)|ERR_(?:NETWORK\w*|CONNECTION\w*|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TIMED_OUT|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|ADDRESS_UNREACHABLE))\b|fetch failed|failed to fetch|socket hang up|network|timed? ?out/i.test(text))return true
    candidate=value.cause
  }
  return false
}

interface UpdateClient {
  disableDifferentialDownload:boolean
  setFeedURL:(options:{provider:'github';owner:string;repo:string}|{provider:'generic';url:string;useMultipleRangeRequest:boolean})=>void
  checkForUpdates:()=>Promise<{updateInfo:{version:string}}|null>
  downloadUpdate:()=>Promise<unknown>
}
/** Retry only source-access failures; package/hash/signature failures stay errors. */
export async function checkAndDownloadAppUpdate(options:{currentVersion:string;updater:UpdateClient;onCurrent:(version:string)=>void;fetchProvider?:FetchProvider;timeoutMs?:number}):Promise<void>{
  const {currentVersion,updater,onCurrent,fetchProvider=fetch,timeoutMs=5000}=options
  let observedVersion=''
  for(const source of ['github','website'] as const){
    try{
      const version=source==='github'?await fetchLatestReleaseVersion(currentVersion,fetchProvider,timeoutMs):await websiteReleaseVersion(currentVersion,fetchProvider,timeoutMs)
      if(source==='website'&&observedVersion&&isNewerVersion(observedVersion,version))throw new Error('Cannot find latest.yml for the newest known release on the website mirror')
      observedVersion=version
      if(!isNewerVersion(version,currentVersion)){onCurrent(version);return}
      updater.setFeedURL(source==='github'?{provider:'github',owner:'Cailiang',repo:'disk-collie'}:{provider:'generic',url:WEBSITE_UPDATE_FEED,useMultipleRangeRequest:false})
      // The fallback works without requesting GitHub-hosted differential blocks.
      updater.disableDifferentialDownload=source==='website'
      const result=await updater.checkForUpdates()
      if(!result)throw new Error('Update source returned no release metadata')
      if(isNewerVersion(version,result.updateInfo.version))throw new Error('Cannot find latest.yml for the announced release')
      if(!isNewerVersion(result.updateInfo.version,currentVersion)){onCurrent(result.updateInfo.version);return}
      await updater.downloadUpdate()
      return
    }catch(error){if(source==='github'&&isUpdateSourceUnavailable(error))continue;throw error}
  }
}

export function reduceUpdateState(
  state: AppUpdateState,
  event: AppUpdateEvent
): AppUpdateState {
  switch (event.type) {
    case 'checking':
      return {
        ...state,
        phase: 'checking',
        downloadPercent: null,
        error: null
      }
    case 'available':
      return {
        ...state,
        latestVersion: event.version,
        updateAvailable: true,
        phase: 'available',
        downloadPercent: 0,
        checkedAt: event.checkedAt ?? new Date().toISOString(),
        error: null
      }
    case 'not-available':
      return {
        ...state,
        latestVersion: event.version,
        updateAvailable: false,
        phase: 'up-to-date',
        downloadPercent: null,
        checkedAt: event.checkedAt ?? new Date().toISOString(),
        error: null
      }
    case 'progress':
      return {
        ...state,
        updateAvailable: true,
        phase: 'downloading',
        downloadPercent: boundedPercent(event.percent),
        error: null
      }
    case 'downloaded':
      return {
        ...state,
        latestVersion: event.version,
        updateAvailable: true,
        phase: 'downloaded',
        downloadPercent: 100,
        error: null
      }
    case 'installing':
      return {
        ...state,
        phase: 'installing',
        error: null
      }
    case 'error':
      return {
        ...state,
        phase: 'error',
        downloadPercent: null,
        checkedAt: event.checkedAt ?? new Date().toISOString(),
        error: event.message
      }
    case 'unsupported':
      return {
        ...state,
        updateAvailable: false,
        phase: 'unsupported',
        downloadPercent: null,
        error: null
      }
  }
}
