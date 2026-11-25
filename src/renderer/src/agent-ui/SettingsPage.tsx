import { supportedLocales } from '../../../shared/localization'
import {
  Check,
  ChevronRight,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  ListFilter,
  LoaderCircle,
  Plus,
  PlugZap,
  RefreshCw,
  Save,
  ScanSearch,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const PROVIDER_LABELS: Record<AgentProvider['type'], [string, string]> = {
  'openai-compatible': ['OpenAI 兼容接口', 'OpenAI-compatible'],
  openai: ['OpenAI', 'OpenAI'],
  anthropic: ['Anthropic', 'Anthropic'],
  antigravity: ['Antigravity', 'Antigravity'],
  google: ['Google Gemini', 'Google Gemini']
}

type ProviderPresetId = 'deepseek' | 'openai' | 'anthropic' | 'google' | 'grok' | 'antigravity' | 'custom'

interface ProviderPreset {
  id: ProviderPresetId
  label: [string, string]
  type: AgentProvider['type']
  baseUrl: string
  recommendedModel: string
}

const PROVIDER_CATALOG: ProviderPreset[] = [
  { id: 'deepseek', label: ['DeepSeek', 'DeepSeek'], type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', recommendedModel: 'deepseek-chat' },
  { id: 'openai', label: ['OpenAI', 'OpenAI'], type: 'openai', baseUrl: 'https://api.openai.com/v1', recommendedModel: 'gpt-5.4' },
  { id: 'anthropic', label: ['Anthropic', 'Anthropic'], type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', recommendedModel: 'claude-opus-4-6' },
  { id: 'google', label: ['Google Gemini', 'Google Gemini'], type: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', recommendedModel: 'gemini-3.1-pro-preview' },
  { id: 'grok', label: ['Grok / xAI', 'Grok / xAI'], type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', recommendedModel: 'grok-4-1-fast-reasoning' },
  { id: 'antigravity', label: ['Antigravity', 'Antigravity'], type: 'antigravity', baseUrl: 'https://code.tczor.cn/antigravity/v1beta', recommendedModel: 'gemini-3.1-pro-high' },
  { id: 'custom', label: ['自定义 OpenAI 兼容接口', 'Custom OpenAI-compatible API'], type: 'openai-compatible', baseUrl: '', recommendedModel: '' }
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
  const preset = PROVIDER_PRESETS.get('deepseek')!
  return {
    name: preset.label[0],
    type: preset.type,
    baseUrl: preset.baseUrl,
    model: preset.recommendedModel,
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
  onManageIgnored,
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
  onManageIgnored: () => void
  onToast: (message: string) => void
}): React.JSX.Element {
  const { text } = useI18n()
  const [selectedId, setSelectedId] = useState<string | 'new'>(() => providers[0]?.id ?? 'new')
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId) ?? null, [providers, selectedId])
  const [draft, setDraft] = useState<SaveAgentProviderInput>(blankProvider)
  const [presetId, setPresetId] = useState<ProviderPresetId>('deepseek')
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | 'default' | null>(null)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelMessage, setModelMessage] = useState<string | null>(null)
  const [manualModel, setManualModel] = useState(false)
  const [localImportBusy, setLocalImportBusy] = useState(false)
  const [ccSwitchBusy, setCcSwitchBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentProvider | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const discoverySequence = useRef(0)
  const initializedDraftProviderId = useRef<string | null>(null)

  useEffect(() => {
    if (!selected) {
      if (selectedId !== 'new' && providers.length) setSelectedId(providers[0].id)
      return
    }
    if (initializedDraftProviderId.current === selected.id) return
    initializedDraftProviderId.current = selected.id
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
    setManualModel(false)
  }, [providers, selected, selectedId])

  const discoverModels = useCallback(async (input: DiscoverAgentModelsInput): Promise<void> => {
    const sequence = ++discoverySequence.current
    setModelState('loading')
    setModelMessage(text("legacy.fetching_available_models.581d71"))
    try {
      const result = await onDiscoverModels(input)
      if (sequence !== discoverySequence.current) return
      setAvailableModels(result.models)
      setModelState('ready')
      setModelMessage(text(
        result.excludedModelCount
          ? `已获取 ${result.models.length} 个 Agent 可用模型，过滤 ${result.excludedModelCount} 个不兼容模型`
          : `已从 ${result.resolvedBaseUrl} 获取 ${result.models.length} 个模型`,
        result.excludedModelCount
          ? `${result.models.length} Agent models found; ${result.excludedModelCount} incompatible models filtered out`
          : `${result.models.length} models found at ${result.resolvedBaseUrl}`
      ))
    } catch (error) {
      if (sequence !== discoverySequence.current) return
      setAvailableModels([])
      setModelState('error')
      setModelMessage(error instanceof Error ? error.message : text("legacy.could_not_fetch_models.e3c31b"))
    }
  }, [onDiscoverModels, text])

  const storedKeyAvailable = Boolean(selected && selected.id === draft.id && selected.keyPresent)
  const discoveryReady = Boolean(draft.baseUrl.trim() && (draft.apiKey?.trim() || storedKeyAvailable))

  useEffect(() => {
    if (!discoveryReady) {
      discoverySequence.current += 1
      setAvailableModels([])
      setModelState('idle')
      setModelMessage(text("legacy.enter_the_base_url_and_api_key_to_fetch_mo.a668f4"))
      return
    }
    const timeout = window.setTimeout(() => {
      void discoverModels({
        id: draft.id,
        type: draft.type,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey
      })
    }, 750)
    return () => {
      window.clearTimeout(timeout)
      discoverySequence.current += 1
    }
  }, [
    discoverModels,
    discoveryReady,
    draft.apiKey,
    draft.baseUrl,
    draft.id,
    draft.type,
    text
  ])

  const selectNew = (): void => {
    initializedDraftProviderId.current = null
    setSelectedId('new')
    setDraft(blankProvider())
    setPresetId('deepseek')
    setConnectionMessage(null)
    setConnectionOk(null)
    setAvailableModels([])
    setModelState('idle')
    setModelMessage(null)
    setManualModel(false)
    setSecretVisible(false)
  }

  const selectPreset = (nextId: ProviderPresetId): void => {
    const next = PROVIDER_PRESETS.get(nextId)!
    setPresetId(nextId)
    setDraft((current) => ({
      ...current,
      name: text(...next.label),
      type: next.type,
      baseUrl: next.baseUrl,
      model: next.recommendedModel || current.model
    }))
    setAvailableModels([])
    setModelState('idle')
    setModelMessage(null)
    setManualModel(false)
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
      setSelectedId(providers.find((item) => item.id !== removed.id)?.id ?? 'new')
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

  const connectionLabel = busy === 'test'
    ? text("legacy.testing.b8baea")
    : connectionOk === true
      ? text("legacy.connected.8537c4")
      : connectionOk === false
        ? text("legacy.test_failed.48c093")
        : selected?.connectionState === 'connected'
          ? text("legacy.connected.8537c4")
          : selected?.connectionState === 'failed'
            ? text("legacy.test_failed.48c093")
            : text("legacy.not_tested.f3970c")
  const connectionClass = connectionOk === true || (!connectionMessage && selected?.connectionState === 'connected')
    ? 'safe'
    : connectionOk === false || (!connectionMessage && selected?.connectionState === 'failed')
      ? 'review'
      : ''
  const updateDescription = updateBusy || updateState?.phase === 'checking'
    ? text("legacy.checking_for_updates.f66330")
    : updateState?.phase === 'available' && updateState.latestVersion
      ? text("legacy.memento_v_was_found_preparing_the_backgrou.a76b14", { p0: updateState.latestVersion })
      : updateState?.phase === 'downloading' && updateState.latestVersion
        ? text("legacy.downloading_memento_v_in_the_background.be1f93", { p0: updateState.latestVersion, p1: updateState.downloadPercent ?? 0 })
        : updateState?.phase === 'downloaded' && updateState.latestVersion
          ? text("legacy.memento_v_is_ready_use_the_update_button_b.257a82", { p0: updateState.latestVersion })
          : updateState?.phase === 'installing'
            ? text("legacy.installing_the_update_memento_will_restart.079d43")
            : updateState?.phase === 'error'
              ? updateState.error ?? text("legacy.could_not_check_for_updates_try_again_late.7be665")
              : updateState?.phase === 'unsupported'
                ? text("legacy.this_package_does_not_support_in_app_updat.0127f5")
                : updateState?.checkedAt
                  ? text("legacy.memento_is_up_to_date.5ae588")
                  : text("legacy.waiting_for_the_first_automatic_check.058bad")
  const updateCheckDisabled = updateBusy || Boolean(updateState && [
    'checking',
    'available',
    'downloading',
    'downloaded',
    'installing'
  ].includes(updateState.phase))
  const activePreset = PROVIDER_PRESETS.get(presetId)!
  const selectableModels = [...new Set([draft.model, ...availableModels])].filter(Boolean)
  const defaultProviderNote = selected?.isDefault
    ? text("legacy.new_agent_tasks_use.2e1a4e", { p0: draft.name || selected.name, p1: draft.model })
    : selected
      ? text("legacy.after_making_this_the_default_new_agent_ta.31f178", { p0: draft.name || selected.name, p1: draft.model })
      : text("legacy.save_this_configuration_before_making_it_t.14eefa")

  return (
    <section className="page content-page is-active">
      <div className="settings-layout">
        <section className="settings-section provider-settings-section">
          <div className="settings-label">
            <h2>{text("legacy.model_providers.f9be3a")}</h2>
            <p>{text("legacy.read_configured_claude_codex_gemini_and_gr.506fa1")}</p>
            <div className="provider-import-actions">
              <button type="button" className="secondary-button" disabled={localImportBusy || ccSwitchBusy} onClick={() => void importLocalAi()}>{localImportBusy ? <LoaderCircle className="spinner" size={14} /> : <ScanSearch size={14} />}{localImportBusy ? text("legacy.scanning.95cde7") : text("legacy.scan_local_ai_configurations.abec64")}</button>
              <button type="button" className="quiet-button" disabled={localImportBusy || ccSwitchBusy} onClick={() => void importCcSwitch()}>{ccSwitchBusy ? <LoaderCircle className="spinner" size={14} /> : <Download size={14} />}{ccSwitchBusy ? text("legacy.copying.ed1d55") : text("legacy.copy_cc_switch_configurations.94e749")}</button>
            </div>
          </div>
          <div className="provider-manager">
            <aside className="provider-list-pane" aria-label={text("legacy.configured_providers.bbd5e6")}>
              <div className="provider-list-header"><span>{text("legacy.configured.d58429", { p0: providers.length })}</span><button type="button" className="icon-button" onClick={selectNew} title={text("legacy.add_provider.f00c8d")} aria-label={text("legacy.add_provider.f00c8d")}><Plus size={15} /></button></div>
              <div className="provider-list">
                {providers.map((provider) => (
                  <button key={provider.id} type="button" className={`provider-item ${selectedId === provider.id ? 'is-active' : ''}`} onClick={() => setSelectedId(provider.id)} aria-pressed={selectedId === provider.id}>
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
                <div><strong>{draft.name || text("legacy.new_provider.669cfd")}</strong><small>{text(...activePreset.label)}{selected && providerSource(selected.id) ? ` · ${text(...providerSource(selected.id)!)}` : ''}</small></div>
                <span className={`risk-label ${connectionClass}`}>{connectionLabel}</span>
              </div>
              <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
                {connectionOk === false && connectionMessage && <div className="provider-error-panel" role="alert"><strong>{text("legacy.connection_test_failed.102c4a")}</strong><p>{connectionMessage}</p></div>}
                {modelState === 'error' && modelMessage && <div className="provider-error-panel" role="alert"><strong>{text("legacy.could_not_fetch_models.5d46ed")}</strong><p>{modelMessage}</p></div>}
                <div className="field"><label htmlFor="provider-preset">{text("legacy.provider.de4d34")}</label><select id="provider-preset" value={presetId} onChange={(event) => selectPreset(event.target.value as ProviderPresetId)}>{PROVIDER_CATALOG.map((preset) => <option key={preset.id} value={preset.id}>{preset.id === 'custom' && presetId === 'custom' && draft.type !== 'openai-compatible' ? text("legacy.imported_custom_configuration.38fdfa") : text(...preset.label)}</option>)}</select></div>
                <div className="field"><label htmlFor="provider-name">{text("legacy.configuration_name.5c730a")}</label><input id="provider-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoComplete="off" /></div>
                <div className="field is-wide"><label htmlFor="provider-key">{text("legacy.api_key.0e7ee4")}</label><div className="secret-field"><input id="provider-key" type={secretVisible ? 'text' : 'password'} value={draft.apiKey ?? ''} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={selected?.keyHint ?? 'sk-...'} autoComplete="new-password" /><button type="button" onClick={() => setSecretVisible((value) => !value)} title={text("legacy.show_or_hide_key.6662fc")} aria-label={text("legacy.show_or_hide_key.6662fc")}>{secretVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
                <div className="recommended-model"><span><strong>{text("legacy.memento_recommended_model.97801d")}</strong><small>{text("legacy.updated_with_memento_saved_configurations_.10bae7")}</small></span><code>{activePreset.recommendedModel || draft.model || text("legacy.choose_manually.686104")}</code></div>
                <details className="provider-advanced">
                  <summary><ChevronRight size={14} />{text("legacy.advanced_settings.c3d603")}</summary>
                  <div className="provider-advanced-grid">
                    {presetId === 'custom' && <div className="field is-wide"><label htmlFor="provider-url">{text("legacy.base_url.bfd5ea")}</label><input id="provider-url" type="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></div>}
                    <div className="field is-wide model-field"><label htmlFor="provider-model">{text("legacy.model.64177c")}</label><div className="model-picker">
                      {manualModel ? <input id="provider-model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="model-name" autoComplete="off" /> : <select id="provider-model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} disabled={modelState === 'loading'}>{selectableModels.length ? selectableModels.map((model) => <option key={model} value={model}>{model}</option>) : <option value="">{modelState === 'loading' ? text("legacy.fetching_models.9f4ae5") : text("legacy.waiting_for_models.305256")}</option>}</select>}
                      <button type="button" className="icon-button" onClick={() => void discoverModels({ id: draft.id, type: draft.type, baseUrl: draft.baseUrl, apiKey: draft.apiKey })} disabled={!discoveryReady || modelState === 'loading'} title={text("legacy.refresh_models.4db6b6")} aria-label={text("legacy.refresh_models.4db6b6")}><RefreshCw className={modelState === 'loading' ? 'spinner' : ''} size={14} /></button>
                    </div><div className={`field-help ${modelState === 'error' ? 'is-error' : ''}`} role="status">{modelState === 'loading' && <LoaderCircle className="spinner" size={11} />}<span>{modelState === 'error' ? text("legacy.fetch_failed_see_the_full_error_above.5dff5c") : modelMessage}</span><button type="button" onClick={() => setManualModel((value) => !value)}>{manualModel ? text("legacy.use_model_list.f52602") : text("legacy.enter_model_id.aaf8c3")}</button></div></div>
                    <p className="provider-advanced-note">{presetId === 'custom' ? text("legacy.the_api_protocol_is_determined_automatical.eefe07", { p0: text(...PROVIDER_LABELS[draft.type]) }) : text("legacy.memento_manages_the_official_endpoint.004e73", { p0: activePreset.baseUrl })}</p>
                  </div>
                </details>
                <p className="default-provider-note">{defaultProviderNote}</p>
                <div className="provider-form-actions">
                  <div>
                    <button type="button" className="quiet-button" disabled={!selected || selected.isDefault || busy !== null} onClick={() => { if (!selected) return; setBusy('default'); void onSetDefaultProvider(selected.id).catch(() => undefined).finally(() => setBusy(null)) }}><CircleCheck size={15} />{selected?.isDefault ? text("legacy.current_default_provider.20abc7") : text("legacy.set_as_default_provider.ada00f")}</button>
                    <button type="button" className="danger-button" disabled={!selected || selected.isDefault || busy !== null} onClick={() => selected && setPendingDelete(selected)} title={selected?.isDefault ? text("legacy.make_another_provider_the_default_first.996064") : undefined}><Trash2 size={15} />{text("legacy.delete_configuration.9829c2")}</button>
                  </div>
                  <div>
                    <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={busy !== null || modelState === 'loading' || !draft.model.trim()}>{busy === 'test' ? <LoaderCircle className="spinner" size={15} /> : <PlugZap size={15} />}{busy === 'test' ? text("legacy.testing.b8baea") : text("legacy.test_connection.322673")}</button>
                    <button type="submit" className="primary-button" disabled={busy !== null || modelState === 'loading' || !draft.model.trim()}>{busy === 'save' ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}{text("legacy.save_configuration.4cde2a")}</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.software_update.68248c")}</h2><p>{text("legacy.memento_checks_hourly_and_downloads_new_ve.3e2f38")}</p></div>
          <div className="setting-row software-update-row"><span className="update-status-copy"><strong>{text("legacy.current_version_v.3f4911", { p0: appVersion })}</strong><small role={updateState?.phase === 'error' ? 'alert' : 'status'} aria-live={updateState?.phase === 'error' ? 'assertive' : 'polite'}>{updateDescription}</small></span><button type="button" className="secondary-button update-check-button" disabled={updateCheckDisabled} onClick={() => void checkUpdates()}>{updateBusy || updateState?.phase === 'checking' ? <LoaderCircle className="spinner" size={14} /> : <RefreshCw size={14} />}{updateBusy || updateState?.phase === 'checking' ? text("legacy.checking.3bc3a3") : text("legacy.check_now.851baa")}</button></div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.window_behavior.85b958")}</h2><p>{text("legacy.control_launch_and_close_behavior.21c065")}</p></div>
          <div>
            <label className="setting-row"><span><strong>{text("legacy.launch_at_login.297159")}</strong><small>{text("legacy.open_memento_after_signing_in.4fcaeb")}</small></span><span className="switch"><input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => updateSettings({ launchAtLogin: event.target.checked })} /><span /></span></label>
            <label className="setting-row"><span><strong>{text("legacy.keep_in_menu_bar.fbbce3")}</strong><small>{text("legacy.reopen_after_closing_the_main_window.8d3db1")}</small></span><span className="switch"><input type="checkbox" checked={settings.closeToTray} onChange={(event) => updateSettings({ closeToTray: event.target.checked })} /><span /></span></label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.ignored_items.988cce")}</h2><p>{text("legacy.health_checks_and_agent_skip_these_items.b18681")}</p></div>
          <div className="ignored-setting-summary"><div><strong>{text("legacy.ignored.95e27a", { p0: settings.storageWhitelist.length + settings.serviceWhitelist.length + settings.applicationWhitelist.length })}</strong><small>{text("legacy.storage_services_applications.2ac5f9", { p0: settings.storageWhitelist.length, p1: settings.serviceWhitelist.length, p2: settings.applicationWhitelist.length })}</small></div><button type="button" className="secondary-button" onClick={onManageIgnored}><ListFilter size={15} />{text("legacy.manage.233004")}</button></div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.appearance.cab005")}</h2><p>{text("legacy.choose_a_color_palette.520434")}</p></div>
          <div className="theme-options" role="radiogroup" aria-label={text("legacy.appearance.cab005")}>
            {THEMES.map((theme) => <button key={theme.id} type="button" role="radio" aria-checked={settings.theme === theme.id} className={`theme-option theme-${theme.id} ${settings.theme === theme.id ? 'is-selected' : ''}`} onClick={() => updateSettings({ theme: theme.id })}><span className="theme-swatches"><i /><i /><i /></span><strong>{text(...theme.label)}</strong><Check size={14} /></button>)}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-label"><h2>{text("legacy.language.53ceee")}</h2><p>{text("legacy.the_app_and_agent_use_the_same_language.20e525")}</p></div>
          <div className="setting-row"><span><strong>{text("legacy.interface_language.5d69db")}</strong><small>{text("legacy.applies_immediately.d0b75b")}</small></span><select aria-label="Language" value={settings.language} onChange={(event) => updateSettings({ language: event.target.value as AppLanguage })}>{supportedLocales.map((locale) => <option key={locale.id} value={locale.id}>{locale.name}</option>)}</select></div>
        </section>
      </div>
      {pendingDelete && <DeleteProviderDialog provider={pendingDelete} busy={busy === 'delete'} onClose={() => busy !== 'delete' && setPendingDelete(null)} onConfirm={() => void deleteProvider()} />}
    </section>
  )
}
