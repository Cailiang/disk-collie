import type {AppLanguage} from './app-settings'
import {translate} from './localization'
import type {StartupAction,StartupItem} from './startup-types'

/** Display metadata stays in a bounded prompt argument, never in executable script source. */
export function startupAuthorizationMessage(items:StartupItem[],action:StartupAction,language:AppLanguage):string {
  const names=[...new Set(items.map(item=>Array.from((item.owner||item.name).replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim()).slice(0,40).join('')).filter(Boolean))]
  const listed=names.slice(0,2).join(language==='zh-CN'?'、':', ')
  const suffix=names.length>2?translate(language,'startup.authorization.more'):''
  return translate(language,'startup.authorization.'+action,{count:items.length,names:listed+suffix})
}
