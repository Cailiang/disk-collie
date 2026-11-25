import en from './locales/en-US.json'
import zh from './locales/zh-CN.json'

/** Add a catalog and registry entry here; UI language types follow this registry. */
export const supportedLocales = [{ id: 'zh-CN', name: '简体中文' }, { id: 'en-US', name: 'English' }] as const
export type LocaleId = typeof supportedLocales[number]['id']
export const localeCatalogs: Record<LocaleId, Record<string, string>> = { 'en-US': en, 'zh-CN': zh }
export function translate(language: LocaleId, key: string, values: Record<string, string | number> = {}): string {
  const source = localeCatalogs[language]?.[key] ?? localeCatalogs['en-US'][key] ?? key
  return source.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]))
}
