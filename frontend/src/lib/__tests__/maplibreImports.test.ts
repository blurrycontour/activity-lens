import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where MapLibre may be imported from.
 *
 * `lib/maplibre` sets the worker URL and installs the tile cache when it is
 * evaluated; a module that imports the library directly gets one with neither,
 * and whether that matters depends on whether some *other* page happened to be
 * opened first. That is exactly the bug this guards: the Maps page took the
 * bare library, so it rendered nothing in a fresh app and rendered fine as soon
 * as a workout's map had been opened once.
 *
 * `tileCache` is the one exception, and has to be: `lib/maplibre` imports it,
 * so it cannot import back.
 */
const ALLOWED = ['src/lib/maplibre.ts', 'src/lib/tileCache.ts']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

describe('maplibre imports', () => {
  it('go through lib/maplibre, which prepares it', () => {
    const offenders = sourceFiles('src').filter(file => {
      if (ALLOWED.includes(file.replaceAll('\\', '/'))) return false
      // A type-only import pulls in no code and runs no side effect, so it is
      // not a way to get an unprepared MapLibre.
      return /^import(?!\s+type)[^\n]*['"]maplibre-gl['"]/m.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })
})
