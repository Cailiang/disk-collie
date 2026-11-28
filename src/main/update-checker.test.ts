import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateState,
  fetchLatestReleaseVersion,
  isMissingUpdateManifestError,
  isNewerVersion,
  reduceUpdateState
} from './update-checker'
import {checkAndDownloadAppUpdate,WEBSITE_RELEASE_ENDPOINT,WEBSITE_UPDATE_FEED} from './update-checker'

describe('update checker', () => {
  it('compares normalized release versions', () => {
    expect(isNewerVersion('v0.6.57', '0.6.56')).toBe(true)
    expect(isNewerVersion('0.6.56', '0.6.56')).toBe(false)
    expect(isNewerVersion('0.6.54', '0.6.56')).toBe(false)
    expect(isNewerVersion('not-a-version', '0.6.56')).toBe(false)
  })

  it('reports the current version while the new repository has no release and still surfaces other failures',async()=>{
    await expect(fetchLatestReleaseVersion('1.0.24',async()=>new Response('',{status:404}))).resolves.toBe('1.0.24')
    await expect(fetchLatestReleaseVersion('1.0.24',async()=>new Response('',{status:403}))).rejects.toThrow('HTTP 403')
  })

  it('reads the latest stable release version before invoking the native updater', async () => {
    const fetchProvider = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.6.54',
      draft: false,
      prerelease: false
    }), { status: 200 }))

    await expect(fetchLatestReleaseVersion('0.6.56', fetchProvider)).resolves.toBe('0.6.54')
    expect(fetchProvider).toHaveBeenCalledWith(
      'https://api.github.com/repos/Cailiang/disk-collie/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'DiskCollie/0.6.56' })
      })
    )
  })

  it('rejects invalid release metadata and recognizes missing updater manifests', async () => {
    const fetchProvider = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'next',
      draft: false,
      prerelease: false
    }), { status: 200 }))

    await expect(fetchLatestReleaseVersion('0.6.56', fetchProvider)).rejects.toThrow('invalid stable release metadata')
    expect(isMissingUpdateManifestError(new Error(
      'Cannot find latest-mac.yml in the latest release artifacts: HttpError: 404'
    ))).toBe(true)
    expect(isMissingUpdateManifestError(new Error(
      'Cannot find latest.yml in the latest release artifacts: HttpError: 404'
    ))).toBe(true)
    expect(isMissingUpdateManifestError(new Error('socket hang up'))).toBe(false)
  })

  it('tracks an available update through background download and installation', () => {
    let state = createUpdateState('0.6.54')
    state = reduceUpdateState(state, { type: 'checking' })
    state = reduceUpdateState(state, {
      type: 'available',
      version: '0.6.55',
      checkedAt: '2026-07-31T10:00:00.000Z'
    })
    state = reduceUpdateState(state, { type: 'progress', percent: 42.4 })
    expect(state).toMatchObject({
      phase: 'downloading',
      latestVersion: '0.6.55',
      updateAvailable: true,
      downloadPercent: 42,
      error: null
    })

    state = reduceUpdateState(state, { type: 'downloaded', version: '0.6.55' })
    expect(state.phase).toBe('downloaded')
    expect(state.downloadPercent).toBe(100)

    state = reduceUpdateState(state, { type: 'installing' })
    expect(state.phase).toBe('installing')
  })

  it('clamps invalid progress values', () => {
    const state = createUpdateState('0.6.54')
    expect(reduceUpdateState(state, { type: 'progress', percent: -4 }).downloadPercent).toBe(0)
    expect(reduceUpdateState(state, { type: 'progress', percent: 142 }).downloadPercent).toBe(100)
    expect(reduceUpdateState(state, { type: 'progress', percent: Number.NaN }).downloadPercent).toBe(0)
  })

  it('records up-to-date, unsupported, and error states', () => {
    const current = createUpdateState('0.6.54')
    const upToDate = reduceUpdateState(current, {
      type: 'not-available',
      version: '0.6.54',
      checkedAt: '2026-07-31T10:00:00.000Z'
    })
    expect(upToDate).toMatchObject({ phase: 'up-to-date', updateAvailable: false })

    const unsupported = reduceUpdateState(current, { type: 'unsupported' })
    expect(unsupported.phase).toBe('unsupported')

    const state = reduceUpdateState(current, {
      type: 'error',
      message: 'network unavailable',
      checkedAt: '2026-07-31T10:00:00.000Z'
    })
    expect(state.phase).toBe('error')
    expect(state.updateAvailable).toBe(false)
    expect(state.error).toBe('network unavailable')
  })
})

describe('GitHub-first app updates with a website fallback',()=>{
  const github=()=>new Response(JSON.stringify({tag_name:'v1.0.33',draft:false,prerelease:false}))
  const website=(version='1.0.33')=>new Response(JSON.stringify({repository:'Cailiang/disk-collie',version,tag:`v${version}`}))
  const client=()=>({disableDifferentialDownload:false,setFeedURL:vi.fn(),checkForUpdates:vi.fn(async()=>({updateInfo:{version:'1.0.33'}})),downloadUpdate:vi.fn(async()=>['owned update'])})
  it('uses only GitHub when it is reachable and automatically starts the download',async()=>{
    const updater=client(),fetchProvider=vi.fn(async()=>github()),onCurrent=vi.fn()
    await checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater,fetchProvider,onCurrent})
    expect(fetchProvider).toHaveBeenCalledTimes(1);expect(updater.setFeedURL).toHaveBeenCalledWith({provider:'github',owner:'Cailiang',repo:'disk-collie'})
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();expect(onCurrent).not.toHaveBeenCalled()
  })
  it('does not contact the website when GitHub reports the installed version',async()=>{
    const updater=client(),fetchProvider=vi.fn(async()=>github()),onCurrent=vi.fn()
    await checkAndDownloadAppUpdate({currentVersion:'1.0.33',updater,fetchProvider,onCurrent})
    expect(fetchProvider).toHaveBeenCalledTimes(1);expect(updater.checkForUpdates).not.toHaveBeenCalled();expect(onCurrent).toHaveBeenCalledWith('1.0.33')
  })
  it.each(['api','manifest','download'])('falls back for a GitHub %s network failure and downloads entirely from the website feed',async phase=>{
    const updater=client(),onCurrent=vi.fn(),fetchProvider=vi.fn(async(input:string|URL|Request)=>{
      if(String(input)===WEBSITE_RELEASE_ENDPOINT)return website()
      if(phase==='api')throw new TypeError('fetch failed')
      return github()
    })
    if(phase==='manifest')updater.checkForUpdates.mockRejectedValueOnce(new Error('HttpError: 503 unavailable'))
    if(phase==='download')updater.downloadUpdate.mockRejectedValueOnce(Object.assign(new Error('socket hang up'),{code:'ECONNRESET'}))
    await checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater,fetchProvider,onCurrent})
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({provider:'generic',url:WEBSITE_UPDATE_FEED,useMultipleRangeRequest:false})
    expect(updater.disableDifferentialDownload).toBe(true);expect(updater.downloadUpdate).toHaveBeenCalled();expect(onCurrent).not.toHaveBeenCalled()
    expect(fetchProvider.mock.calls.some(([input])=>String(input)===WEBSITE_RELEASE_ENDPOINT)).toBe(true)
  })
  it('aborts a stalled GitHub request and checks the website',async()=>{
    const updater=client(),fetchProvider=vi.fn((input:string|URL|Request,init?:RequestInit)=>String(input)===WEBSITE_RELEASE_ENDPOINT?Promise.resolve(website()):new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')))))
    await checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater,fetchProvider,onCurrent:vi.fn(),timeoutMs:25})
    expect(fetchProvider).toHaveBeenCalledTimes(2)
  })
  it('does not hide integrity failures by retrying another source',async()=>{
    const updater=client(),fetchProvider=vi.fn(async()=>github())
    updater.downloadUpdate.mockRejectedValue(new Error('sha512 checksum mismatch'))
    await expect(checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater,fetchProvider,onCurrent:vi.fn()})).rejects.toThrow('checksum mismatch')
    expect(fetchProvider).toHaveBeenCalledTimes(1)
  })
  it('rejects stale updater manifests and invalid website identity before downloading',async()=>{
    const updater=client()
    updater.checkForUpdates.mockResolvedValue({updateInfo:{version:'1.0.32'}})
    await expect(checkAndDownloadAppUpdate({currentVersion:'1.0.31',updater,fetchProvider:async()=>github(),onCurrent:vi.fn()})).rejects.toThrow('announced release')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    const fallback=client(),fetchProvider=vi.fn(async(input:string|URL|Request)=>{
      if(String(input)===WEBSITE_RELEASE_ENDPOINT)return new Response(JSON.stringify({repository:'Other/repo',version:'1.0.33',tag:'v1.0.33'}))
      throw new TypeError('fetch failed')
    })
    await expect(checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater:fallback,fetchProvider,onCurrent:vi.fn()})).rejects.toThrow('invalid stable release metadata')
    expect(fallback.downloadUpdate).not.toHaveBeenCalled()
  })
  it('does not label an out-of-date mirror as current after GitHub already announced a newer version',async()=>{
    const updater=client(),onCurrent=vi.fn(),fetchProvider=vi.fn(async(input:string|URL|Request)=>String(input)===WEBSITE_RELEASE_ENDPOINT?website('1.0.32'):github())
    updater.downloadUpdate.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(checkAndDownloadAppUpdate({currentVersion:'1.0.32',updater,fetchProvider,onCurrent})).rejects.toThrow('newest known release')
    expect(onCurrent).not.toHaveBeenCalled()
  })
})
