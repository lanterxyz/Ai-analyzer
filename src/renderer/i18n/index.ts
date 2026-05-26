// Locale provider hook
import { useState, useCallback } from 'react'
import { Locale } from '@shared/types'
import zh from './zh'
import en from './en'

const locales: Record<Locale, Record<string, string>> = {
  [Locale.ZH]: zh,
  [Locale.EN]: en
}

export function useLocale(initial: Locale = Locale.ZH) {
  const [locale, setLocale] = useState(initial)

  const t = useCallback((key: string): string => {
    return locales[locale]?.[key] || key
  }, [locale])

  return { locale, setLocale, t }
}

export default useLocale
