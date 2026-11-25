import { createContext, useContext } from 'react'
import type { AppLanguage } from '../../shared/app-settings'
import { translate, localeCatalogs } from '../../shared/localization'
export { translate, localeCatalogs, supportedLocales } from '../../shared/localization'

interface I18nValue {
  language: AppLanguage
  locale: string
  text: (key: string, valuesOrEnglish?: string | Record<string, string | number>) => string
  t: (key: string, values?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({
  language: 'zh-CN',
  locale: 'zh-CN',
  text: (key) => translate('zh-CN', key),
  t: (key, values) => translate('zh-CN', key, values)
})

export function I18nProvider({
  language,
  children
}: {
  language: AppLanguage
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <I18nContext.Provider
      value={{
        language,
        locale: language,
        text: (key, valuesOrEnglish) => typeof valuesOrEnglish === 'string'
          ? localeCatalogs[language]?.[key] ?? (language === 'zh-CN' ? key : valuesOrEnglish)
          : translate(language, key, valuesOrEnglish),
        t: (key, values) => translate(language, key, values)
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
