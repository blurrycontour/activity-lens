import { describe, it, expect } from 'vitest'
import { filenameFromDisposition } from '../api'

// The server sends both header forms: a quoted ASCII-only `filename` for old
// clients and an RFC 5987 `filename*` carrying the real, possibly non-ASCII
// name. Reading the wrong one saves the file under a mangled name, which is
// silent — the download still works, it just comes out called "l_uf.gpx".
describe('filenameFromDisposition', () => {
  it('reads a plain quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="morning run.gpx"'))
      .toBe('morning run.gpx')
  })

  it('prefers the encoded form, which is the one that survives non-ASCII', () => {
    const header = `attachment; filename="l_uf.gpx"; filename*=UTF-8''l%C3%A4uf.gpx`
    expect(filenameFromDisposition(header)).toBe('läuf.gpx')
  })

  it('falls back to the quoted form when the encoding is malformed', () => {
    const header = `attachment; filename="safe.gpx"; filename*=UTF-8''%E0%A4%A`
    expect(filenameFromDisposition(header)).toBe('safe.gpx')
  })

  it('returns empty when there is no header, so the caller names the file', () => {
    expect(filenameFromDisposition(null)).toBe('')
    expect(filenameFromDisposition('attachment')).toBe('')
  })
})
