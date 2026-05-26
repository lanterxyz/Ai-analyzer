// ============================================================================
// Crypto Script Extractor - Three-tier JS encryption code extraction
// Extracts crypto-related code from captured JS response bodies with
// context-aware snippet extraction and budget-limited output
// ============================================================================

import { CapturedRequest } from '@shared/types'
import { createLogger } from '../logger'

const logger = createLogger('crypto-script-extractor')

// --- Types ---

export interface CryptoSnippet {
  /** Source request sequence number */
  seq: number
  /** Source request URL (truncated) */
  url: string
  /** Tier level (1 = highest, 2 = medium, 3 = lowest) */
  tier: 1 | 2 | 3
  /** Pattern that matched */
  matchPattern: string
  /** Line number where the match starts (1-based) */
  startLine: number
  /** Extracted code snippet */
  code: string
}

export interface CryptoExtractionResult {
  snippets: CryptoSnippet[]
  budgetUsed: number
}

// --- Tier 1 Patterns (Highest Priority) ---
// Known crypto libraries and APIs
const TIER1_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /crypto\.subtle\b/, name: 'crypto.subtle' },
  { pattern: /CryptoJS\b/, name: 'CryptoJS' },
  { pattern: /JSEncrypt\b/, name: 'JSEncrypt' },
  { pattern: /\bforge\b/, name: 'forge' },
  { pattern: /\bforge\.(cipher|md|pki|pkcs|aes|rsa)\b/, name: 'forge.crypto' },
  { pattern: /RSAKey\b/, name: 'RSAKey' },
  { pattern: /\bSM2\b/, name: 'SM2' },
  { pattern: /\bSM3\b/, name: 'SM3' },
  { pattern: /\bSM4\b/, name: 'SM4' },
  { pattern: /sm2\.\w+\(/, name: 'sm2.method' },
  { pattern: /sm3\.\w+\(/, name: 'sm3.method' },
  { pattern: /sm4\.\w+\(/, name: 'sm4.method' },
  { pattern: /WebCryptoAPI/i, name: 'WebCryptoAPI' },
  { pattern: /node-forge/, name: 'node-forge' },
  { pattern: /sjcl\b/, name: 'Stanford JS Crypto Library' },
  { pattern: /tweetnacl\b/, name: 'tweetnacl' },
  { pattern: /libsodium\b/, name: 'libsodium' },
  { pattern: /asmcrypto\b/, name: 'asmcrypto' }
]

// --- Tier 2 Patterns (Medium Priority) ---
// Function names and algorithm identifiers associated with encryption
const TIER2_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bencrypt\s*\(/, name: 'encrypt()' },
  { pattern: /\bdecrypt\s*\(/, name: 'decrypt()' },
  { pattern: /\bsign\s*\(/, name: 'sign()' },
  { pattern: /\bverify\s*\(/, name: 'verify()' },
  { pattern: /\bcreateCipher\w*\(/, name: 'createCipher' },
  { pattern: /\bcreateHash\(/, name: 'createHash' },
  { pattern: /\bcreateHmac\(/, name: 'createHmac' },
  { pattern: /\bcreateSign\(/, name: 'createSign' },
  { pattern: /\bcreateVerify\(/, name: 'createVerify' },
  { pattern: /\bcreateDecipher\w*\(/, name: 'createDecipher' },
  { pattern: /\bAES[-_]?(CBC|ECB|GCM|CTR|CFB)/i, name: 'AES mode' },
  { pattern: /\bRSA[-_]?(OAEP|PKCS)/i, name: 'RSA mode' },
  { pattern: /\bDES[-_]?(CBC|ECB|CFB)/i, name: 'DES mode' },
  { pattern: /\bSHA[-_]?(1|256|384|512)\b/i, name: 'SHA hash' },
  { pattern: /\bMD5\b/, name: 'MD5' },
  { pattern: /\bHMAC\b/i, name: 'HMAC' },
  { pattern: /\bPBKDF2\b/i, name: 'PBKDF2' },
  { pattern: /\bECDSA\b/i, name: 'ECDSA' },
  { pattern: /\bECDH\b/i, name: 'ECDH' },
  { pattern: /\bAES\b/, name: 'AES' },
  { pattern: /\bRSA\b/, name: 'RSA' },
  { pattern: /\bDES\b/, name: 'DES' },
  { pattern: /\b3DES\b/, name: '3DES' },
  { pattern: /\bBlowfish\b/i, name: 'Blowfish' },
  { pattern: /\bChacha20\b/i, name: 'Chacha20' },
  { pattern: /\bPoly1305\b/i, name: 'Poly1305' },
  { pattern: /\bgetPublicKey\b/i, name: 'getPublicKey' },
  { pattern: /\bgetPrivateKey\b/i, name: 'getPrivateKey' },
  { pattern: /\bkeygen(?:erate)?\b/i, name: 'keygen' }
]

// --- Tier 3 Patterns (Lowest Priority) ---
// Base encoding operations that may be part of crypto pipelines
const TIER3_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bbtoa\s*\(/, name: 'btoa()' },
  { pattern: /\batob\s*\(/, name: 'atob()' },
  { pattern: /\bBase64\b/i, name: 'Base64' },
  { pattern: /\.charCodeAt\s*\(/, name: 'charCodeAt()' },
  { pattern: /\bfromCharCode\s*\(/, name: 'fromCharCode()' },
  { pattern: /\bencodeURIComponent\s*\(/, name: 'encodeURIComponent()' },
  { pattern: /\bdecodeURIComponent\s*\(/, name: 'decodeURIComponent()' },
  { pattern: /\bTextEncoder\b/, name: 'TextEncoder' },
  { pattern: /\bTextDecoder\b/, name: 'TextDecoder' }
]

// --- Constants ---
const CONTEXT_LINES = 15 // Lines of context above and below match
const MERGE_GAP = 5 // Merge ranges that are within 5 lines of each other
const BUDGET_LIMIT = 20 * 1024 // 20KB max output budget

/**
 * Extract crypto-related code snippets from captured JS response bodies.
 * Uses three-tier pattern matching with context extraction and budget enforcement.
 *
 * @param requests - Captured requests to scan for JS responses
 * @param hookStacks - Optional JS hook call stacks to also scan for inline crypto code
 * @returns Extracted snippets with budget usage info
 */
export function extract(
  requests: CapturedRequest[],
  hookStacks?: string[]
): CryptoExtractionResult {
  logger.info('Starting crypto script extraction', {
    requestCount: requests.length,
    hasHookStacks: !!hookStacks
  })

  const allSnippets: CryptoSnippet[] = []
  let budgetUsed = 0

  // Collect JS response bodies
  const jsBodies: { seq: number; url: string; body: string }[] = []

  for (const req of requests) {
    // Only consider JS responses
    const isJs = isJavaScriptResponse(req)
    if (!isJs || !req.responseBody) continue

    jsBodies.push({
      seq: req.seq,
      url: req.url,
      body: req.responseBody
    })
  }

  // Also scan hook call stacks if provided
  if (hookStacks && hookStacks.length > 0) {
    for (let i = 0; i < hookStacks.length; i++) {
      const stack = hookStacks[i]
      if (!stack) continue
      // Treat each hook stack as a virtual "file" to scan
      const snippets = extractFromSource(stack, -1, '<hook-call-stack>', CONTEXT_LINES)
      allSnippets.push(...snippets)
      budgetUsed += snippets.reduce((sum, s) => sum + s.code.length, 0)
    }
  }

  // Extract from JS bodies
  for (const { seq, url, body } of jsBodies) {
    if (budgetUsed >= BUDGET_LIMIT) {
      logger.info('Budget limit reached, stopping extraction')
      break
    }

    const remainingBudget = BUDGET_LIMIT - budgetUsed
    const snippets = extractFromSource(body, seq, url, CONTEXT_LINES, remainingBudget)
    allSnippets.push(...snippets)
    budgetUsed += snippets.reduce((sum, s) => sum + s.code.length, 0)
  }

  // Sort: Tier 1 first, then Tier 2, then Tier 3; within same tier, by seq
  allSnippets.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.seq - b.seq
  })

  // Final budget enforcement: trim from the end if over budget
  const finalSnippets: CryptoSnippet[] = []
  let totalSize = 0
  for (const snippet of allSnippets) {
    if (totalSize + snippet.code.length > BUDGET_LIMIT) {
      // Try to truncate the code rather than dropping it
      const remaining = BUDGET_LIMIT - totalSize
      if (remaining > 50) {
        finalSnippets.push({
          ...snippet,
          code: snippet.code.substring(0, remaining) + '\n// ... [truncated]'
        })
        totalSize += remaining + 22
      }
      break
    }
    finalSnippets.push(snippet)
    totalSize += snippet.code.length
  }

  logger.info('Crypto script extraction complete', {
    snippetCount: finalSnippets.length,
    budgetUsed: totalSize,
    tier1: finalSnippets.filter(s => s.tier === 1).length,
    tier2: finalSnippets.filter(s => s.tier === 2).length,
    tier3: finalSnippets.filter(s => s.tier === 3).length
  })

  return {
    snippets: finalSnippets,
    budgetUsed: totalSize
  }
}

/**
 * Extract crypto snippets from a single source (JS body or hook stack).
 * Returns merged, non-overlapping ranges around matching lines.
 */
function extractFromSource(
  source: string,
  seq: number,
  url: string,
  contextLines: number,
  budgetLimit?: number
): CryptoSnippet[] {
  const lines = source.split('\n')
  const rawSnippets: CryptoSnippet[] = []
  let usedBudget = 0

  // Collect all match positions per tier
  const tier1Ranges = findMatches(lines, TIER1_PATTERNS, contextLines)
  const tier2Ranges = findMatches(lines, TIER2_PATTERNS, contextLines)
  const tier3Ranges = findMatches(lines, TIER3_PATTERNS, contextLines)

  // Merge ranges within each tier, then produce snippets
  // Tier 1 (highest priority)
  const merged1 = mergeRanges(tier1Ranges, lines.length)
  for (const range of merged1) {
    const code = lines.slice(range.start, range.end + 1).join('\n')
    const snippet: CryptoSnippet = {
      seq,
      url: truncateUrl(url),
      tier: 1,
      matchPattern: range.patterns.join(', '),
      startLine: range.start + 1,
      code
    }
    if (budgetLimit && usedBudget + code.length > budgetLimit) break
    rawSnippets.push(snippet)
    usedBudget += code.length
  }

  // Tier 2
  const merged2 = mergeRanges(tier2Ranges, lines.length)
  for (const range of merged2) {
    const code = lines.slice(range.start, range.end + 1).join('\n')
    const snippet: CryptoSnippet = {
      seq,
      url: truncateUrl(url),
      tier: 2,
      matchPattern: range.patterns.join(', '),
      startLine: range.start + 1,
      code
    }
    if (budgetLimit && usedBudget + code.length > budgetLimit) break
    rawSnippets.push(snippet)
    usedBudget += code.length
  }

  // Tier 3
  const merged3 = mergeRanges(tier3Ranges, lines.length)
  for (const range of merged3) {
    const code = lines.slice(range.start, range.end + 1).join('\n')
    const snippet: CryptoSnippet = {
      seq,
      url: truncateUrl(url),
      tier: 3,
      matchPattern: range.patterns.join(', '),
      startLine: range.start + 1,
      code
    }
    if (budgetLimit && usedBudget + code.length > budgetLimit) break
    rawSnippets.push(snippet)
    usedBudget += code.length
  }

  return rawSnippets
}

// --- Range tracking per match ---

interface MatchRange {
  start: number
  end: number
  patterns: string[]
}

/**
 * Find all matches for a set of patterns and return their context ranges.
 */
function findMatches(
  lines: string[],
  patterns: { pattern: RegExp; name: string }[],
  contextLines: number
): MatchRange[] {
  const ranges: MatchRange[] = []

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    for (const { pattern, name } of patterns) {
      if (pattern.test(line)) {
        const start = Math.max(0, lineIdx - contextLines)
        const end = Math.min(lines.length - 1, lineIdx + contextLines)
        ranges.push({ start, end, patterns: [name] })
        break // One match per line is enough; will merge patterns later
      }
    }
  }

  return ranges
}

/**
 * Merge overlapping and nearby ranges, combining their pattern names.
 */
function mergeRanges(ranges: MatchRange[], _totalLines: number): MatchRange[] {
  if (ranges.length === 0) return []

  // Sort by start position
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: MatchRange[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    // If current range overlaps or is within MERGE_GAP lines of the last
    if (current.start <= last.end + MERGE_GAP) {
      // Extend the last range
      last.end = Math.max(last.end, current.end)
      // Merge pattern names
      for (const p of current.patterns) {
        if (!last.patterns.includes(p)) {
          last.patterns.push(p)
        }
      }
    } else {
      merged.push(current)
    }
  }

  return merged
}

/**
 * Determine if a response is JavaScript content.
 */
function isJavaScriptResponse(req: CapturedRequest): boolean {
  // Check content type
  const ct = (req.contentType || '').toLowerCase()
  if (ct.includes('javascript') || ct.includes('application/x-javascript')) {
    return true
  }

  // Check URL extension
  if (/\.js(?:\?|$)/i.test(req.url)) {
    return true
  }

  // Check response headers for content-type
  const respCt = req.responseHeaders?.['content-type']?.toLowerCase() || ''
  if (respCt.includes('javascript') || respCt.includes('application/x-javascript')) {
    return true
  }

  // Heuristic: check if body looks like JavaScript
  if (req.responseBody) {
    const trimmed = req.responseBody.trim()
    if (/^(var|let|const|function|class|import|export|\(function)/m.test(trimmed)) {
      return true
    }
    // Minified JS or module patterns
    if (/^!function|^define\(|require\(/m.test(trimmed)) {
      return true
    }
  }

  return false
}

/**
 * Truncate a URL for inclusion in snippet metadata.
 */
function truncateUrl(url: string): string {
  if (url.length <= 80) return url
  try {
    const parsed = new URL(url)
    const pathPart = parsed.pathname.length > 50
      ? parsed.pathname.substring(0, 50) + '...'
      : parsed.pathname
    return `${parsed.origin}${pathPart}`
  } catch {
    return url.substring(0, 80)
  }
}
