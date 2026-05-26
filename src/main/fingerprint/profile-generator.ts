// Fingerprint Profile Generator - Generates realistic random browser fingerprint profiles
import { FingerprintProfile } from '@shared/types'
import { v4 as uuid } from 'uuid'

// ============================================================================
// Realistic Fingerprint Data Pools
// ============================================================================

// Common user agent strings grouped by platform
const USER_AGENTS: Record<string, string[]> = {
  win: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
  ],
  mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:132.0) Gecko/20100101 Firefox/132.0'
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
  ],
  android: [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  ]
}

const PLATFORMS: Record<string, string> = {
  win: 'Win32',
  mac: 'MacIntel',
  linux: 'Linux x86_64',
  android: 'Linux armv8l'
}

const LANGUAGES: Record<string, { primary: string; list: string[] }> = {
  zh: { primary: 'zh-CN', list: ['zh-CN', 'zh', 'en-US', 'en'] },
  en: { primary: 'en-US', list: ['en-US', 'en', 'zh-CN', 'zh'] },
  ja: { primary: 'ja', list: ['ja', 'en-US', 'en'] },
  ko: { primary: 'ko', list: ['ko', 'en-US', 'en'] },
  zh_tw: { primary: 'zh-TW', list: ['zh-TW', 'zh', 'en-US', 'en'] }
}

const COLOR_DEPTHS = [24, 30, 32]

const DEVICE_MEMORIES = [2, 4, 8, 16, 32]

const HARDWARE_CONCURRENCIES = [2, 4, 6, 8, 12, 16, 24, 32]

const SCREEN_RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1366, 768],
  [1536, 864],
  [1440, 900],
  [1680, 1050],
  [1280, 720],
  [1600, 900],
  [2560, 1600]
]

const TIMEZONE_OFFSETS = [
  -480,  // Asia/Shanghai (UTC+8)
  -540,  // Asia/Tokyo (UTC+9)
  -570,  // Asia/Seoul (UTC+9:30 - actually Korea is UTC+9, but kept for diversity)
  -420,  // Asia/Bangkok (UTC+7)
  -480,  // Asia/Hong_Kong (UTC+8)
  -480,  // Asia/Singapore (UTC+8)
  -480,  // Asia/Taipei (UTC+8)
  0,     // Europe/London (UTC+0)
  -60,   // Europe/Paris (UTC+1)
  -120,  // Europe/Helsinki (UTC+2)
  300,   // America/New_York (UTC-5)
  360,   // America/Chicago (UTC-6)
  420,   // America/Denver (UTC-7)
  480    // America/Los_Angeles (UTC-8)
]

const WEBGL_VENDORS_AND_RENDERERS: { vendor: string; renderer: string }[] = [
  // Intel integrated
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770, OpenGL 4.5)' },
  // NVIDIA
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.5)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER, OpenGL 4.5)' },
  // AMD
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.5)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics, OpenGL 4.5)' },
  // Apple Silicon
  { vendor: 'Apple Inc.', renderer: 'Apple M1' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2' },
  { vendor: 'Apple Inc.', renderer: 'Apple M3' },
  { vendor: 'Apple Inc.', renderer: 'Apple M1 Pro' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2 Pro' }
]

// ============================================================================
// Random Selection Helpers
// ============================================================================

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ============================================================================
// Profile Generator
// ============================================================================

export interface ProfileGeneratorOptions {
  /** Preferred platform: 'win' | 'mac' | 'linux' | 'android'. Default: random */
  platform?: string
  /** Preferred language: 'zh' | 'en' | 'ja' | 'ko' | 'zh_tw'. Default: random weighted toward zh/en */
  language?: string
  /** Custom profile name. Default: auto-generated */
  name?: string
}

/**
 * Generates a random but realistic browser fingerprint profile.
 *
 * Each field is chosen from a pool of values that are commonly seen
 * in real browsers, making the fingerprint appear natural to
 * fingerprinting scripts while being unique enough to avoid tracking.
 */
export function generate(options?: ProfileGeneratorOptions): FingerprintProfile {
  // Choose platform
  const platformKey = options?.platform || randomItem(['win', 'win', 'win', 'mac', 'mac', 'linux'])
  const platform = PLATFORMS[platformKey]

  // Choose user agent consistent with platform
  const userAgent = randomItem(USER_AGENTS[platformKey] || USER_AGENTS.win)

  // Choose language
  const langKey = options?.language || randomItem(['zh', 'zh', 'en', 'en', 'ja'])
  const langConfig = LANGUAGES[langKey] || LANGUAGES.zh
  const language = langConfig.primary
  // Slightly randomize the language list order for diversity
  const languages = [...langConfig.list]
  if (Math.random() > 0.7) {
    // Occasionally add an extra language
    const extras = ['fr', 'de', 'es', 'ru', 'pt', 'it']
    const extra = randomItem(extras)
    if (!languages.includes(extra)) {
      languages.push(extra)
    }
  }

  // Color depth
  const colorDepth = randomItem(COLOR_DEPTHS)

  // Device memory - higher for desktop, lower for mobile
  const memoryOptions = platformKey === 'android'
    ? [2, 4, 6, 8]
    : DEVICE_MEMORIES
  const deviceMemory = randomItem(memoryOptions)

  // Hardware concurrency - higher for desktop, lower for mobile
  const concurrencyOptions = platformKey === 'android'
    ? [2, 4, 6, 8]
    : HARDWARE_CONCURRENCIES
  const hardwareConcurrency = randomItem(concurrencyOptions)

  // Screen resolution
  const screenResolution = randomItem(SCREEN_RESOLUTIONS)
  // Available screen resolution accounts for OS taskbar (typically 40px on Windows, 25px on Mac)
  const taskbarHeight = platformKey === 'win' ? randomItem([40, 48]) : platformKey === 'mac' ? 25 : 0
  const availableScreenResolution: [number, number] = [
    screenResolution[0],
    screenResolution[1] - taskbarHeight
  ]

  // Timezone offset
  const timezoneOffset = randomItem(TIMEZONE_OFFSETS)

  // WebGL vendor / renderer
  const webglPair = randomItem(WEBGL_VENDORS_AND_RENDERERS)

  // Generate name
  const name = options?.name || `Random Profile ${Date.now()}`

  const profile: FingerprintProfile = {
    id: uuid(),
    name,
    userAgent,
    platform,
    language,
    languages,
    colorDepth,
    deviceMemory,
    hardwareConcurrency,
    screenResolution,
    availableScreenResolution,
    timezoneOffset,
    webglVendor: webglPair.vendor,
    webglRenderer: webglPair.renderer,
    isDefault: false,
    createdAt: Date.now()
  }

  return profile
}

/**
 * Generate multiple unique fingerprint profiles.
 * Ensures no two profiles have the same userAgent + screenResolution + timezoneOffset combination.
 */
export function generateMultiple(count: number, options?: ProfileGeneratorOptions): FingerprintProfile[] {
  const profiles: FingerprintProfile[] = []
  const seen = new Set<string>()

  let attempts = 0
  const maxAttempts = count * 5

  while (profiles.length < count && attempts < maxAttempts) {
    attempts++
    const profile = generate(options)
    const key = `${profile.userAgent}|${profile.screenResolution}|${profile.timezoneOffset}`
    if (!seen.has(key)) {
      seen.add(key)
      profiles.push(profile)
    }
  }

  return profiles
}
