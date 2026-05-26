// Fingerprint Profile Store - Persists fingerprint profiles to the database
import { FingerprintProfile } from '@shared/types'
import { getDatabase } from '../db/database'
import { createLogger } from '../logger'

const logger = createLogger('profile-store')

// Row type from SQLite (screen_resolution stored as comma-separated string)
interface FingerprintProfileRow {
  id: string
  name: string
  user_agent: string
  platform: string
  language: string
  languages: string          // JSON string
  color_depth: number
  device_memory: number
  hardware_concurrency: number
  screen_resolution: string  // "width,height"
  available_screen_resolution: string // "width,height"
  timezone_offset: number
  webgl_vendor: string
  webgl_renderer: string
  is_default: number         // 0 or 1
  created_at: number
}

/**
 * Converts a raw database row to a FingerprintProfile object.
 */
function rowToProfile(row: FingerprintProfileRow): FingerprintProfile {
  const screenRes = row.screen_resolution.split(',').map(Number) as [number, number]
  const availRes = row.available_screen_resolution.split(',').map(Number) as [number, number]

  return {
    id: row.id,
    name: row.name,
    userAgent: row.user_agent,
    platform: row.platform,
    language: row.language,
    languages: JSON.parse(row.languages),
    colorDepth: row.color_depth,
    deviceMemory: row.device_memory,
    hardwareConcurrency: row.hardware_concurrency,
    screenResolution: screenRes,
    availableScreenResolution: availRes,
    timezoneOffset: row.timezone_offset,
    webglVendor: row.webgl_vendor,
    webglRenderer: row.webgl_renderer,
    isDefault: row.is_default === 1,
    createdAt: row.created_at
  }
}

/**
 * Converts a FingerprintProfile object to database row values.
 */
function profileToRow(profile: FingerprintProfile): {
  id: string
  name: string
  user_agent: string
  platform: string
  language: string
  languages: string
  color_depth: number
  device_memory: number
  hardware_concurrency: number
  screen_resolution: string
  available_screen_resolution: string
  timezone_offset: number
  webgl_vendor: string
  webgl_renderer: string
  is_default: number
  created_at: number
} {
  return {
    id: profile.id,
    name: profile.name,
    user_agent: profile.userAgent,
    platform: profile.platform,
    language: profile.language,
    languages: JSON.stringify(profile.languages),
    color_depth: profile.colorDepth,
    device_memory: profile.deviceMemory,
    hardware_concurrency: profile.hardwareConcurrency,
    screen_resolution: `${profile.screenResolution[0]},${profile.screenResolution[1]}`,
    available_screen_resolution: `${profile.availableScreenResolution[0]},${profile.availableScreenResolution[1]}`,
    timezone_offset: profile.timezoneOffset,
    webgl_vendor: profile.webglVendor,
    webgl_renderer: profile.webglRenderer,
    is_default: profile.isDefault ? 1 : 0,
    created_at: profile.createdAt
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List all fingerprint profiles.
 */
export function listProfiles(): FingerprintProfile[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM fingerprint_profiles ORDER BY created_at DESC').all() as FingerprintProfileRow[]
  return rows.map(rowToProfile)
}

/**
 * Get a single fingerprint profile by ID.
 */
export function getProfile(id: string): FingerprintProfile | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM fingerprint_profiles WHERE id = ?').get(id) as FingerprintProfileRow | undefined
  return row ? rowToProfile(row) : null
}

/**
 * Save (upsert) a fingerprint profile.
 * If a profile with the same ID exists, it will be updated.
 * If this profile is set as default, all other profiles will be unset as default.
 */
export function saveProfile(profile: FingerprintProfile): void {
  const db = getDatabase()
  const row = profileToRow(profile)

  db.transaction(() => {
    // If this is the new default, clear existing default(s)
    if (profile.isDefault) {
      db.prepare('UPDATE fingerprint_profiles SET is_default = 0').run()
    }

    db.prepare(`
      INSERT INTO fingerprint_profiles (
        id, name, user_agent, platform, language, languages,
        color_depth, device_memory, hardware_concurrency,
        screen_resolution, available_screen_resolution,
        timezone_offset, webgl_vendor, webgl_renderer,
        is_default, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        user_agent = excluded.user_agent,
        platform = excluded.platform,
        language = excluded.language,
        languages = excluded.languages,
        color_depth = excluded.color_depth,
        device_memory = excluded.device_memory,
        hardware_concurrency = excluded.hardware_concurrency,
        screen_resolution = excluded.screen_resolution,
        available_screen_resolution = excluded.available_screen_resolution,
        timezone_offset = excluded.timezone_offset,
        webgl_vendor = excluded.webgl_vendor,
        webgl_renderer = excluded.webgl_renderer,
        is_default = excluded.is_default
    `).run(
      row.id, row.name, row.user_agent, row.platform, row.language, row.languages,
      row.color_depth, row.device_memory, row.hardware_concurrency,
      row.screen_resolution, row.available_screen_resolution,
      row.timezone_offset, row.webgl_vendor, row.webgl_renderer,
      row.is_default, row.created_at
    )
  })()

  logger.info('Fingerprint profile saved', { id: profile.id, name: profile.name })
}

/**
 * Delete a fingerprint profile by ID.
 * Will not delete the default profile unless it is the only one.
 */
export function deleteProfile(id: string): boolean {
  const db = getDatabase()

  // Check if this is the default profile
  const row = db.prepare('SELECT is_default FROM fingerprint_profiles WHERE id = ?').get(id) as { is_default: number } | undefined
  if (!row) {
    logger.warn('Fingerprint profile not found for deletion', { id })
    return false
  }

  // Count total profiles
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM fingerprint_profiles').get() as { cnt: number }
  if (row.is_default === 1 && countRow.cnt > 1) {
    // Don't delete the default if there are other profiles
    // User should set a different one as default first
    logger.warn('Cannot delete the default profile while other profiles exist', { id })
    return false
  }

  const result = db.prepare('DELETE FROM fingerprint_profiles WHERE id = ?').run(id)
  const deleted = result.changes > 0
  if (deleted) {
    logger.info('Fingerprint profile deleted', { id })
  }
  return deleted
}

/**
 * Set a profile as the default, unsetting any existing default.
 */
export function setDefaultProfile(id: string): boolean {
  const db = getDatabase()

  // Check profile exists
  const row = db.prepare('SELECT id FROM fingerprint_profiles WHERE id = ?').get(id)
  if (!row) {
    logger.warn('Fingerprint profile not found', { id })
    return false
  }

  db.transaction(() => {
    db.prepare('UPDATE fingerprint_profiles SET is_default = 0').run()
    db.prepare('UPDATE fingerprint_profiles SET is_default = 1 WHERE id = ?').run(id)
  })()

  logger.info('Default fingerprint profile set', { id })
  return true
}

/**
 * Get the current default profile, if any.
 */
export function getDefaultProfile(): FingerprintProfile | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM fingerprint_profiles WHERE is_default = 1 LIMIT 1').get() as FingerprintProfileRow | undefined
  return row ? rowToProfile(row) : null
}
