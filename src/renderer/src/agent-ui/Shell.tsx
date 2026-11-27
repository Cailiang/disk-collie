import {NavigationIcon} from './NavigationIcon'
import {CollieMark} from '../CollieMark'
import { AppWindow, Archive, Copy, File, HardDrive, History, House, Layers3, LoaderCircle, Monitor, RefreshCw, Settings2, ShieldCheck, Sparkles, SquareTerminal, Activity } from 'lucide-react'
import type { AgentProvider } from '../../../shared/agent-types'
import type { AppUpdateState } from '../../../shared/types'
import {AiTaskToolbar} from '../AiTasks'
import { useI18n } from '../i18n'

export type AgentViewKey = 'overview' | 'health' | 'large' | 'duplicates' | 'privacy' | 'processes' | 'apps' | 'disk' | 'terminal' | 'agent' | 'history' | 'settings'

export function Shell({ activeView, provider, appVersion, updateState, hostname, osVersion, onNavigate, onInstallUpdate, children }: {
  activeView: AgentViewKey; provider: AgentProvider | null; healthCount:number; applicationCount:number; terminalCount:number;
  appVersion:string; updateState:AppUpdateState|null; hostname:string; osVersion:string;
  onNavigate:(view:AgentViewKey)=>void; onInstallUpdate:()=>void; children:React.ReactNode
}):React.JSX.Element {
  const {t}=useI18n()
  const storage=[{id:'health',key:'cleanup'},{id:'large',key:'large'},{id:'duplicates',key:'duplicates'},{id:'disk',key:'disk'},{id:'privacy',key:'privacy'}] as const
  const tools=[{id:'apps',key:'apps'},{id:'processes',key:'processes'},{id:'terminal',key:'terminal'},{id:'agent',key:'agent'}] as const
  const utility=[{id:'settings',key:'settings'}] as const
  const nav=(item:{id:AgentViewKey;key:string}):React.JSX.Element=><button key={item.id} type="button" className={`nav-button ${activeView===item.id?'is-active':''}`} title={t(`nav.${item.key}`)} aria-current={activeView===item.id?'page':undefined} onClick={()=>onNavigate(item.id)}><NavigationIcon kind={item.id}/><span>{t(`nav.${item.key}`)}</span>{activeView===item.id&&<i/>}</button>
  const platform=window.diskCollie?.platform
  const platformName=platform==='darwin'?'macOS':platform==='win32'?'Windows':platform==='linux'?'Linux':''
  return <div className="app-shell"><a className="space-skip" href="#main-content">{t('nav.skip')}</a><aside className="sidebar"><div className="brand"><span className="brand-mark brand-mascot"><CollieMark label={t('brand.collie')}/></span><div className="brand-copy"><strong>DiskCollie</strong><span className="brand-meta"><span className="brand-version">v{appVersion}</span>{updateState?.phase==='downloaded'?<button className="brand-update-button" aria-label="Install update" onClick={onInstallUpdate}><RefreshCw size={12}/></button>:updateState?.phase==='downloading'?<LoaderCircle className="spinner" size={12}/>:null}</span></div></div><nav className="nav-list" aria-label={t('nav.main')}>{nav({id:'overview',key:'home'})}<div className="space-nav-label">{t('nav.storage')}</div>{storage.map(nav)}<div className="space-nav-label">{t('nav.tools')}</div>{tools.map(nav)}</nav><div className="sidebar-footer"><nav className="utility-nav" aria-label={t('nav.utilities')}>{utility.map(nav)}</nav><button className="provider-state" onClick={()=>onNavigate('settings')}><span className={`status-dot ${provider?.connectionState==='connected'?'':'is-muted'}`}/><div><strong>{provider?provider.name:t('nav.model')}</strong><small>{provider?provider.model:t('nav.noModel')}</small></div><Settings2 size={14}/></button></div></aside><div className="workspace"><header className="topbar"><div className="device-status"><Monitor size={15}/><strong>{hostname||t('nav.device')}</strong><span>{platformName} {osVersion}</span></div><div className="space-topbar-right"><AiTaskToolbar/>{!window.diskCollie&&<span className="workspace-mode">{t('nav.demo')}</span>}</div></header><main className="page-stack" id="main-content" tabIndex={-1}>{children}</main></div></div>
}
