import { supportedLocales } from '../../../shared/localization'
import {
  Check,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  Folder,
  LoaderCircle,
  Plus,
  PlugZap,
  RefreshCw,
  Save,
  ScanSearch,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentProvider,
  AgentProviderModelsResult,
  AgentProviderTestResult,
  CcSwitchImportResult,
  DiscoverAgentModelsInput,
  LocalAiImportResult,
  SaveAgentProviderInput
} from '../../../shared/agent-types'
import type { AppLanguage, AppSettings, AppTheme, UpdateAppSettingsInput } from '../../../shared/app-settings'
import type { AppUpdateState } from '../../../shared/types'
import { useI18n } from '../i18n'
import { DeleteProviderDialog } from './Dialogs'
import {WorkspaceHelp} from '../WorkspaceHelp'
import './SettingsPage.css'

type ProviderPresetId = 'deepseek' | 'openai' | 'anthropic' | 'google' | 'grok' | 'custom'

interface ProviderPreset {
  id: ProviderPresetId
  label: [string, string]
  type: AgentProvider['type']
  baseUrl: string
}

const PROVIDER_CATALOG: ProviderPreset[] = [
  { id: 'deepseek', label: ['DeepSeek', 'DeepSeek'], type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'openai', label: ['OpenAI', 'OpenAI'], type: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: ['Anthropic', 'Anthropic'], type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'google', label: ['Google Gemini', 'Google Gemini'], type: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'grok', label: ['Grok / xAI', 'Grok / xAI'], type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1' },
  { id: 'custom', label: ['自定义 OpenAI 兼容接口', 'Custom OpenAI-compatible API'], type: 'openai-compatible', baseUrl: '' }
]

const PROVIDER_PRESETS = new Map(PROVIDER_CATALOG.map((preset) => [preset.id, preset]))

function normalizedUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function inferProviderPreset(provider: Pick<AgentProvider, 'type' | 'baseUrl'>): ProviderPresetId {
  return PROVIDER_CATALOG.find((preset) => (
    preset.id !== 'custom' &&
    preset.type === provider.type &&
    normalizedUrl(preset.baseUrl) === normalizedUrl(provider.baseUrl)
  ))?.id ?? 'custom'
}

function providerSource(id: string): [string, string] | null {
  if (id.startsWith('cc-switch-')) return ['已导入副本', 'Imported copy']
  if (id.startsWith('local-config-claude-')) return ['Claude', 'Claude']
  if (id.startsWith('local-config-codex-')) return ['Codex', 'Codex']
  if (id.startsWith('local-config-gemini-')) return ['Gemini', 'Gemini']
  if (id.startsWith('local-config-grok-')) return ['Grok', 'Grok']
  return null
}

const THEMES: Array<{ id: AppTheme; label: [string, string] }> = [
  { id: 'porcelain', label: ['雾瓷朱红', 'Porcelain red'] },
  { id: 'graphite', label: ['莱姆终端', 'Lime terminal'] },
  { id: 'tiffany', label: ['蒂芙尼晨雾', 'Tiffany mist'] },
  { id: 'klein', label: ['克莱因蓝图', 'Klein blueprint'] },
  { id: 'burgundy', label: ['勃艮第书房', 'Burgundy study'] },
  { id: 'mars', label: ['马尔斯工坊', 'Mars workshop'] },
  { id: 'prussian', label: ['普鲁士夜航', 'Prussian night'] },
  { id: 'midnight', label: ['午夜青珊', 'Midnight cyan'] }
]

function blankProvider(): SaveAgentProviderInput {
  const preset = PROVIDER_PRESETS.get('custom')!
  return {
    name: '',
    type: preset.type,
    baseUrl: preset.baseUrl,
    model: '',
    apiKey: ''
  }
}

export function SettingsPage({
  settings,
  providers,
  appVersion,
  updateState,
  onUpdateSettings,
  onDiscoverModels,
  onSaveProvider,
  onTestProvider,
  onDeleteProvider,
  onSetDefaultProvider,
  onImportLocalAi,
  onImportCcSwitch,
  onCheckUpdates,
  onAddScanDirectory,
  onRemoveScanDirectory,
  onToast
}: {
  settings: AppSettings
  providers: AgentProvider[]
  appVersion: string
  updateState: AppUpdateState | null
  onUpdateSettings: (input: UpdateAppSettingsInput) => Promise<void>
  onDiscoverModels: (input: DiscoverAgentModelsInput) => Promise<AgentProviderModelsResult>
  onSaveProvider: (input: SaveAgentProviderInput) => Promise<AgentProvider>
  onTestProvider: (input: SaveAgentProviderInput) => Promise<AgentProviderTestResult>
  onDeleteProvider: (id: string) => Promise<void>
  onSetDefaultProvider: (id: string) => Promise<void>
  onImportLocalAi: () => Promise<LocalAiImportResult>
  onImportCcSwitch: () => Promise<CcSwitchImportResult>
  onCheckUpdates: () => Promise<void>
  onAddScanDirectory: () => Promise<void>
  onRemoveScanDirectory: (path:string) => Promise<void>
  onToast: (message: string) => void
}): React.JSX.Element {
  const { text } = useI18n()
  const [selectedId, setSelectedId] = useState<string | 'new'>(() => providers[0]?.id ?? 'new')
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId) ?? null, [providers, selectedId])
  const [draft, setDraft] = useState<SaveAgentProviderInput>(blankProvider)
  const [presetId, setPresetId] = useState<ProviderPresetId>('custom')
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | 'default' | null>(null)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelMessage, setModelMessage] = useState<string | null>(null)
  const [localImportBusy, setLocalImportBusy] = useState(false)
  const [ccSwitchBusy, setCcSwitchBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentProvider | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [directoryBusy,setDirectoryBusy]=useState<string|null>(null)
  const discoverySequence = useRef(0)
  const initializedDraftProviderId = useRef<string | null>(null)

  useEffect(() => {
    if (!selected) {
      if (selectedId !== 'new' && providers.length) setSelectedId(providers[0].id)
      return
    }
    if (initializedDraftProviderId.current === selected.id) return
    initializedDraftProviderId.current = selected.id
    discoverySequence.current++
    setDraft({
      id: selected.id,
      name: selected.name,
      type: selected.type,
      baseUrl: selected.baseUrl,
      model: selected.model,
      apiKey: ''
    })
    setPresetId(inferProviderPreset(selected))
    setConnectionMessage(null)
    setConnectionOk(null)
    setAvailableModels([])
    setModelState('idle')
    setModelMessage(null)
  }, [providers, selected, selectedId])

  const storedKeyAvailable = Boolean(selected&&selected.id===draft.id&&selected.keyPresent&&selected.type===draft.type&&normalizedUrl(selected.baseUrl)===normalizedUrl(draft.baseUrl))
  const discoveryReady = Boolean(draft.baseUrl.trim() && (draft.apiKey?.trim() || storedKeyAvailable))
  const discoverModels = async (): Promise<void> => {
    const sequence = ++discoverySequence.current
    const previousModel=draft.model
    setModelState('loading');setModelMessage(null);setAvailableModels([])
    try {
      const result = await onDiscoverModels({id:draft.id,type:draft.type,baseUrl:draft.baseUrl,apiKey:draft.apiKey})
      if(sequence!==discoverySequence.current)return
      setAvailableModels(result.models);setModelState('ready')
      setModelMessage(text('settings.modelsCount',{count:result.models.length}))
      setDraft((current)=>({...current,model:result.models.includes(previousModel)?previousModel:''}))
    }catch(error){
      if(sequence!==discoverySequence.current)return
      setAvailableModels([]);setModelState('error')
      const message=error instanceof Error?error.message:text('legacy.could_not_fetch_models.e3c31b')
      setModelMessage(message)
      onToast(message)
    }
  }
  const changeConnection=(changes:Partial<SaveAgentProviderInput>):void=>{
    discoverySequence.current++;setAvailableModels([]);setModelState('idle');setModelMessage(null)
    setConnectionMessage(null);setConnectionOk(null)
    setDraft((current)=>({...current,...changes,model:''}))
  }
  const selectExisting=(id:string):void=>{discoverySequence.current++;initializedDraftProviderId.current=null;setSecretVisible(false);setSelectedId(id)}
  const directoryAction=async(target:string|null):Promise<void>=>{
    if(directoryBusy)return
    setDirectoryBusy(target||'add')
    try{if(target)await onRemoveScanDirectory(target);else await onAddScanDirectory()}
    catch(error){onToast(error instanceof Error?error.message:text('settings.directoryFailed'))}
    finally{setDirectoryBusy(null)}
  }
  const selectNew = (): void => {
    initializedDraftProviderId.current = null
    discoverySequence.current++
    setSelectedId('new')
    setDraft(blankProvider())
    setPresetId('custom')
    setConnectionMessage(null)
    setConnectionOk(null)
    setAvailableModels([])
    setModelState('idle')
    setModelMessage(null)
    setSecretVisible(false)
  }

  const selectPreset = (nextId: ProviderPresetId): void => {
    const next = PROVIDER_PRESETS.get(nextId)!
    setPresetId(nextId)
    changeConnection({type:next.type,baseUrl:next.baseUrl})
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      const saved = await onSaveProvider(draft)
      setSelectedId(saved.id)
      setDraft((current) => ({ ...current, id: saved.id, apiKey: '' }))
      onToast(text("legacy.provider_saved_with_encrypted_credentials.8d9b7a"))
    } catch {
      // App owns the user-facing error toast.
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    setBusy('test')
    setConnectionMessage(text("legacy.testing_tool_calling_with.98a1af", { p0: draft.model }))
    setConnectionOk(null)
    try {
      const result = await onTestProvider(draft)
      setConnectionMessage(result.message)
      setConnectionOk(result.ok)
      onToast(result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : text("legacy.connection_test_failed.102c4a")
      setConnectionMessage(message)
      setConnectionOk(false)
    } finally {
      setBusy(null)
    }
  }

  const updateSettings = (input: UpdateAppSettingsInput): void => {
    void onUpdateSettings(input).catch((error) => {
      onToast(error instanceof Error ? error.message : text("legacy.could_not_update_settings.07fbcc"))
    })
  }

  const importCcSwitch = async (): Promise<void> => {
    setCcSwitchBusy(true)
    try {
      await onImportCcSwitch()
    } catch {
      // App owns the user-facing error toast.
    } finally {
      setCcSwitchBusy(false)
    }
  }

  const importLocalAi = async (): Promise<void> => {
    setLocalImportBusy(true)
    try {
      await onImportLocalAi()
    } catch {
      // App owns the user-facing error toast.
    } finally {
      setLocalImportBusy(false)
    }
  }

  const deleteProvider = async (): Promise<void> => {
    if (!pendingDelete) return
    const removed = pendingDelete
    setBusy('delete')
    try {
      await onDeleteProvider(removed.id)
      setPendingDelete(null)
      const next=providers.find((item)=>item.id!==removed.id)
      if(next)selectExisting(next.id);else selectNew()
    } catch {
      // App owns the user-facing error toast.
    } finally {
      setBusy(null)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      await onCheckUpdates()
    } finally {
      setUpdateBusy(false)
    }
  }

  const savedConnectionMatches = Boolean(selected && selected.id === draft.id &&
    selected.type === draft.type && normalizedUrl(selected.baseUrl) === normalizedUrl(draft.baseUrl) &&
    selected.model === draft.model && !draft.apiKey?.trim())
  const savedConnectionState = savedConnectionMatches ? selected?.connectionState : 'untested'
  const connectionLabel = busy === 'test'
    ? text("legacy.testing.b8baea")
    : connectionOk === true
      ? text("legacy.connected.8537c4")
      : connectionOk === false
        ? text("legacy.test_failed.48c093")
        : savedConnectionState === 'connected'
          ? text("legacy.connected.8537c4")
          : savedConnectionState === 'failed'
            ? text("legacy.test_failed.48c093")
            : text("legacy.not_tested.f3970c")
  const connectionClass = connectionOk === true || (!connectionMessage && savedConnectionState === 'connected')
    ? 'safe'
    : connectionOk === false || (!connectionMessage && savedConnectionState === 'failed')
      ? 'review'
      : ''
  const updateDescription = updateBusy || updateState?.phase === 'checking'
    ? text('legacy.checking_for_updates.f66330')
    : updateState?.phase==='available'&&updateState.latestVersion?text('settings.updateAvailable',{version:updateState.latestVersion})
    : updateState?.phase==='downloading'?text('settings.updateDownloading',{percent:Math.round(updateState.downloadPercent||0)})
    : updateState?.phase==='downloaded'?text('settings.updateReady')
    : updateState?.phase==='installing'?text('settings.updateInstalling')
    : updateState?.phase==='error'?updateState.error||text('legacy.could_not_check_for_updates_try_again_late.7be665')
    : updateState?.phase==='unsupported'?text('settings.updateUnsupported')
    : updateState?.checkedAt?text('legacy.diskcollie_is_up_to_date.5ae588'):''
  const updateCheckDisabled = updateBusy || Boolean(updateState && [
    'checking',
    'available',
    'downloading',
    'downloaded',
    'installing'
  ].includes(updateState.phase))
  const selectableModels = [...new Set([draft.model, ...availableModels])].filter(Boolean)

  return (
    <section className="page content-page settings-page is-active">
      <div className="settings-layout">
        <section className="settings-section provider-settings-section">
          <div className="settings-label">
            <div className="settings-section-title"><h2>{text('legacy.model_providers.f9be3a')}</h2><WorkspaceHelp><strong>{text('settings.modelPurpose')}</strong><p>{text('settings.modelBenefits')}</p><p>{text('settings.modelOptional')}</p><p>{text('settings.modelData')}</p><p>{text('settings.providerHelp')}</p><p>{text('settings.providerKeyHelp')}</p></WorkspaceHelp></div>
          </div>
          <div className="provider-settings-content"><div className="provider-import-actions"><button type="button" className="secondary-button" disabled={localImportBusy||ccSwitchBusy} onClick={()=>void importLocalAi()}>{localImportBusy?<LoaderCircle className="spinner" size={14}/>:<ScanSearch size={14}/>} {text('legacy.scan_local_ai_configurations.abec64')}</button><button type="button" className="quiet-button" disabled={localImportBusy||ccSwitchBusy} onClick={()=>void importCcSwitch()}>{ccSwitchBusy?<LoaderCircle className="spinner" size={14}/>:<Download size={14}/>} {text('legacy.copy_cc_switch_configurations.94e749')}</button></div>
          <div className="provider-manager">
            <aside className="provider-list-pane" aria-label={text("legacy.configured_providers.bbd5e6")}>
              <div className="provider-list-header"><span>{text("legacy.configured.d58429", { p0: providers.length })}</span><button type="button" className="icon-button" disabled={busy!==null} onClick={selectNew} title={text("legacy.add_provider.f00c8d")} aria-label={text("legacy.add_provider.f00c8d")}><Plus size={15} /></button></div>
              <div className="provider-list">
                {providers.map((provider) => (
                  <button key={provider.id} type="button" className={`provider-item ${selectedId === provider.id ? 'is-active' : ''}`} disabled={busy!==null} onClick={() => selectExisting(provider.id)} aria-pressed={selectedId === provider.id}>
                    <span className="provider-mark">{provider.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                    <span><strong>{provider.name}</strong><small>{provider.model}{providerSource(provider.id) ? ` · ${text(...providerSource(provider.id)!)}` : ''}</small></span>
                    {provider.isDefault && <span className="default-chip">{text("legacy.default.58cd59")}</span>}
                  </button>
                ))}
                {selectedId === 'new' && <button type="button" className="provider-item is-active"><span className="provider-mark">+</span><span><strong>{text("legacy.new_provider.669cfd")}</strong><small>{text("legacy.not_saved.058ce5")}</small></span></button>}
              </div>
            </aside>

            <div className="provider-editor">
              <div className="provider-editor-header">
                <div><strong>{draft.name || text('legacy.new_provider.669cfd')}</strong></div>
                <span className={`risk-label ${connectionClass}`}>{connectionLabel}</span>
              </div>
              <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
                {connectionOk === false && connectionMessage && <div className="provider-error-panel" role="alert"><strong>{text("legacy.connection_test_failed.102c4a")}</strong><p>{connectionMessage}</p></div>}
                {modelState === 'error' && modelMessage && <div className="provider-error-panel" role="alert"><strong>{text("legacy.could_not_fetch_models.5d46ed")}</strong><p>{modelMessage}</p></div>}
                <fieldset className="provider-fields" disabled={busy!==null}>
                  <div className="field"><label htmlFor="provider-preset">{text('settings.providerType')}</label><select id="provider-preset" value={presetId} onChange={(event)=>selectPreset(event.target.value as ProviderPresetId)}>{PROVIDER_CATALOG.map((preset)=><option key={preset.id} value={preset.id}>{preset.id==='custom'&&draft.type!=='openai-compatible'?text('legacy.imported_custom_configuration.38fdfa'):text(...preset.label)}</option>)}</select></div>
                  <div className="field"><label htmlFor="provider-name">{text('legacy.configuration_name.5c730a')}</label><input id="provider-name" value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})} autoComplete="off"/></div>
                  <div className="field"><label htmlFor="provider-url">{text('settings.serviceUrl')}</label><input id="provider-url" type="url" value={draft.baseUrl} readOnly={presetId!=='custom'} onChange={(event)=>changeConnection({baseUrl:event.target.value})} placeholder="https://api.example.com/v1" autoComplete="url"/></div>
                  <div className="field"><label htmlFor="provider-key">{text('legacy.api_key.0e7ee4')}</label><div className="secret-field"><input id="provider-key" type={secretVisible?'text':'password'} value={draft.apiKey??''} onChange={(event)=>changeConnection({apiKey:event.target.value})} placeholder={storedKeyAvailable?selected?.keyHint||'sk-...':'sk-...'} autoComplete="new-password"/><button type="button" onClick={()=>setSecretVisible((value)=>!value)} title={text('legacy.show_or_hide_key.6662fc')} aria-label={text('legacy.show_or_hide_key.6662fc')}>{secretVisible?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></div>
                  <div className="provider-model-fetch"><button type="button" className="secondary-button" onClick={()=>void discoverModels()} disabled={!discoveryReady||modelState==='loading'}>{modelState==='loading'?<LoaderCircle className="spinner" size={14}/>:<RefreshCw size={14}/>} {text('settings.fetchModels')}</button>{modelState!=='error'&&modelMessage&&<span role="status">{modelMessage}</span>}</div>
                  <div className="field model-field"><label htmlFor="provider-model">{text('legacy.model.64177c')}</label><select id="provider-model" value={draft.model} onChange={(event)=>{setConnectionMessage(null);setConnectionOk(null);setDraft({...draft,model:event.target.value})}} disabled={modelState==='loading'||!selectableModels.length}><option value="">{text('settings.chooseModel')}</option>{selectableModels.map((model)=><option key={model} value={model}>{model}</option>)}</select></div>
                </fieldset>
                <div className="provider-form-actions">
                  <div>
                    <button type="button" className="quiet-button" disabled={!selected || selected.isDefault || busy !== null} onClick={() => { if (!selected) return; setBusy('default'); void onSetDefaultProvider(selected.id).catch(() => undefined).finally(() => setBusy(null)) }}><CircleCheck size={15} />{selected?.isDefault ? text("legacy.current_default_provider.20abc7") : text("legacy.set_as_default_provider.ada00f")}</button>
                    <button type="button" className="danger-button" disabled={!selected || selected.isDefault || busy !== null} onClick={() => selected && setPendingDelete(selected)} title={selected?.isDefault ? text("legacy.make_another_provider_the_default_first.996064") : undefined}><Trash2 size={15} />{text("legacy.delete_configuration.9829c2")}</button>
                  </div>
                  <div>
                    <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={busy !== null || modelState === 'loading' || !draft.model.trim() || !draft.name.trim() || !discoveryReady}>{busy === 'test' ? <LoaderCircle className="spinner" size={15} /> : <PlugZap size={15} />}{busy === 'test' ? text("legacy.testing.b8baea") : text("legacy.test_connection.322673")}</button>
                    <button type="submit" className="primary-button" disabled={busy !== null || modelState === 'loading' || !draft.model.trim() || !draft.name.trim() || !discoveryReady}>{busy === 'save' ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}{text("legacy.save_configuration.4cde2a")}</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.software_update.68248c")}</h2></div>
          <div className="setting-row software-update-row"><span className="update-status-copy"><strong>{text("legacy.current_version_v.3f4911", { p0: appVersion })}</strong><small role={updateState?.phase === 'error' ? 'alert' : 'status'} aria-live={updateState?.phase === 'error' ? 'assertive' : 'polite'}>{updateDescription}</small></span><button type="button" className="secondary-button update-check-button" disabled={updateCheckDisabled} onClick={() => void checkUpdates()}>{updateBusy || updateState?.phase === 'checking' ? <LoaderCircle className="spinner" size={14} /> : <RefreshCw size={14} />}{updateBusy || updateState?.phase === 'checking' ? text("legacy.checking.3bc3a3") : text("legacy.check_now.851baa")}</button></div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.window_behavior.85b958")}</h2></div>
          <div>
            <label className="setting-row"><span><strong>{text("legacy.launch_at_login.297159")}</strong></span><span className="switch"><input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => updateSettings({ launchAtLogin: event.target.checked })} /><span /></span></label>
            <label className="setting-row"><span><strong>{text("legacy.keep_in_menu_bar.fbbce3")}</strong></span><span className="switch"><input type="checkbox" checked={settings.closeToTray} onChange={(event) => updateSettings({ closeToTray: event.target.checked })} /><span /></span></label>
          </div>
        </section>

        <section className="settings-section scan-exclusion-settings">
          <div className="settings-label"><h2>{text('settings.scanDirectories')}</h2></div>
          <div className="scan-directory-manager"><div className="scan-directory-toolbar"><span>{text('settings.directoryCount',{count:settings.scanExcludedDirectories.length})}</span><button type="button" className="secondary-button" disabled={directoryBusy!==null} onClick={()=>void directoryAction(null)}>{directoryBusy==='add'?<LoaderCircle className="spinner" size={14}/>:<Plus size={14}/>} {text('settings.addDirectory')}</button></div>{settings.scanExcludedDirectories.length?<ul className="scan-directory-list">{settings.scanExcludedDirectories.map((directory)=><li key={directory}><Folder size={16}/><code title={directory}>{directory}</code><button type="button" className="icon-button" disabled={directoryBusy!==null} aria-label={text('settings.removeDirectory',{path:directory})} data-tooltip={text('settings.remove')} onClick={()=>void directoryAction(directory)}>{directoryBusy===directory?<LoaderCircle className="spinner" size={15}/>:<Trash2 size={15}/>}</button></li>)}</ul>:<p className="scan-directory-empty">{text('settings.noDirectories')}</p>}</div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.appearance.cab005")}</h2></div>
          <div className="theme-options" role="radiogroup" aria-label={text("legacy.appearance.cab005")}>
            {THEMES.map((theme) => <button key={theme.id} type="button" role="radio" aria-checked={settings.theme === theme.id} className={`theme-option theme-${theme.id} ${settings.theme === theme.id ? 'is-selected' : ''}`} onClick={() => updateSettings({ theme: theme.id })}><span className="theme-swatches"><i /><i /><i /></span><strong>{text(...theme.label)}</strong><Check size={14} /></button>)}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.language.53ceee")}</h2></div>
          <div className="setting-row"><span><strong>{text("legacy.interface_language.5d69db")}</strong></span><select aria-label="Language" value={settings.language} onChange={(event) => updateSettings({ language: event.target.value as AppLanguage })}>{supportedLocales.map((locale) => <option key={locale.id} value={locale.id}>{locale.name}</option>)}</select></div>
        </section>
      </div>
      {pendingDelete && <DeleteProviderDialog provider={pendingDelete} busy={busy === 'delete'} onClose={() => busy !== 'delete' && setPendingDelete(null)} onConfirm={() => void deleteProvider()} />}
    </section>
  )
}
