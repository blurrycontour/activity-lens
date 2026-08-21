import { describe, it, expect, vi, afterEach } from 'vitest'
import { zipSync, gzipSync, strToU8 } from 'fflate'
import { expand, hashFile, summarize, runImport, type ImportItem } from '../importQueue'
// Statically imported so the spies below patch the same module instance
// importQueue captured at load time.
import { api } from '../api'

const GPX = '<?xml version="1.0"?><gpx version="1.1"><trk><name>Run</name></trk></gpx>'

function file(name: string, content: string | Uint8Array): File {
  const data = typeof content === 'string' ? strToU8(content) : content
  return new File([data as BlobPart], name, { type: 'application/octet-stream' })
}

describe('expand', () => {
  it('passes plain workout files through untouched', async () => {
    const input = [file('morning.gpx', GPX), file('ride.tcx', GPX)]
    const { files, skipped } = await expand(input)
    expect(files.map(f => f.name)).toEqual(['morning.gpx', 'ride.tcx'])
    expect(skipped).toEqual([])
  })

  // The shape a Strava export actually has: a ZIP of gzipped GPX and raw .fit
  // under an activities/ prefix, alongside metadata this app has no use for.
  // Getting this wrong means either importing nothing or reporting a wrong
  // count, both of which look broken.
  it('unwraps a Strava-shaped export and accounts for every entry', async () => {
    const zip = zipSync({
      'activities/1001.gpx': strToU8(GPX),
      'activities/1002.gpx.gz': gzipSync(strToU8(GPX)),
      'activities/1003.fit': strToU8('binary-fit-data'),
      'activities.csv': strToU8('id,name\n1001,Run'),
      '__MACOSX/._activities': strToU8('resource fork'),
    })

    const { files, skipped } = await expand([file('export.zip', zip)])

    // The .fit rides along with the rest now that the server can read one —
    // in a Strava export it is the original recording and the .gpx is the
    // lossy copy beside it.
    expect(files.map(f => f.name).sort()).toEqual(['1001.gpx', '1002.gpx', '1003.fit'])
    // The .gz came out decompressed, not still gzipped.
    expect(await files.find(f => f.name === '1002.gpx')!.text()).toBe(GPX)
    // Nothing vanishes silently: the .csv is reported rather than dropped.
    expect(skipped.map(s => s.name).sort()).toEqual(['activities.csv'])
    expect(skipped.every(s => s.reason === 'unsupported')).toBe(true)
  })

  it('unwraps a bare .gpx.gz shared straight from an export folder', async () => {
    const { files, skipped } = await expand([file('12345.gpx.gz', gzipSync(strToU8(GPX)))])
    expect(files.map(f => f.name)).toEqual(['12345.gpx'])
    expect(await files[0].text()).toBe(GPX)
    expect(skipped).toEqual([])
  })

  it('reports unsupported and empty files rather than dropping them', async () => {
    const { files, skipped } = await expand([
      file('notes.txt', 'hello'),
      file('empty.gpx', ''),
      file('good.gpx', GPX),
    ])
    expect(files.map(f => f.name)).toEqual(['good.gpx'])
    expect(skipped).toEqual([
      { name: 'notes.txt', reason: 'unsupported' },
      { name: 'empty.gpx', reason: 'empty' },
    ])
  })

  it('treats a corrupt archive as one unsupported file, not a crash', async () => {
    const { files, skipped } = await expand([file('broken.zip', 'not actually a zip')])
    expect(files).toEqual([])
    expect(skipped).toEqual([{ name: 'broken.zip', reason: 'unsupported' }])
  })

  // A zip bomb is cheap to make and this runs in the user's tab. The guard
  // exists so an oversized archive fails visibly instead of freezing the
  // browser, so it has to actually stop rather than merely flag.
  it('stops expanding once the entry limit is reached', async () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < 1200; i++) entries[`activities/${i}.gpx`] = strToU8(GPX)

    const { files, skipped } = await expand([file('huge.zip', zipSync(entries))])

    expect(files.length).toBe(1000)
    expect(skipped.some(s => s.reason === 'too-many')).toBe(true)
  })

  it('handles extensions case-insensitively, as exporters vary', async () => {
    const { files } = await expand([file('RIDE.TCX', GPX), file('Run.GpX', GPX)])
    expect(files.map(f => f.name)).toEqual(['RIDE.TCX', 'Run.GpX'])
  })
})

describe('hashFile', () => {
  // The server derives a workout's import identity from sha256 of the uploaded
  // bytes. If this disagrees by even a byte, no file is ever recognised as
  // already imported and every rescan re-uploads everything.
  it('matches the SHA-256 the server computes over the same bytes', async () => {
    // echo -n "abc" | sha256sum
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await hashFile(file('a.gpx', 'abc'))).toBe(expected)
  })
})

describe('summarize', () => {
  it('counts what the import button and its breakdown show', () => {
    const items = [
      { status: 'ready' }, { status: 'ready' },
      { status: 'duplicate' },
      { status: 'error' },
    ] as ImportItem[]
    const skipped = [{ name: 'x.csv', reason: 'unsupported' as const }]

    expect(summarize(items, skipped)).toEqual({ ready: 2, duplicates: 1, errors: 2, total: 5 })
  })
})

describe('runImport', () => {
  afterEach(() => vi.restoreAllMocks())

  function item(name: string): ImportItem {
    return { id: name, file: file(name, GPX), hash: 'h-' + name, status: 'ready' }
  }

  // Partial success is the normal outcome of a bulk import: one unreadable file
  // out of two hundred must not cost the other 199.
  it('continues past a failing file and reports partial success', async () => {
    vi.spyOn(api, 'importWorkout').mockImplementation(async (f: File) => {
      if (f.name === 'bad.gpx') throw new Error('parse failed')
      if (f.name === 'dupe.gpx') return { duplicate: true } as never
      return {} as never
    })
    vi.spyOn(api, 'finalizeImport').mockResolvedValue(undefined)

    const items = [item('a.gpx'), item('bad.gpx'), item('dupe.gpx'), item('b.gpx')]
    const result = await runImport(items)

    expect(result).toEqual({ imported: 2, duplicates: 1, failed: 1 })
    expect(items.map(i => i.status)).toEqual(['imported', 'failed', 'duplicate', 'imported'])
    expect(items[1].error).toBeTruthy()
  })

  // The sport is chosen per file, not per batch: an export archive is a year of
  // mixed activities, so one setting across all of them can only ever be right
  // for the files that already agreed with it.
  it('sends each file its own sport, and nothing for the ones left alone', async () => {
    const importSpy = vi.spyOn(api, 'importWorkout').mockResolvedValue({} as never)
    vi.spyOn(api, 'finalizeImport').mockResolvedValue(undefined)

    const items = [item('a.gpx'), item('b.gpx'), item('c.gpx')]
    items[0].type = 'Hike'
    items[2].type = 'Swim'
    await runImport(items)

    const sent = new Map(importSpy.mock.calls.map(c => [(c[0] as File).name, c[1]]))
    expect(sent.get('a.gpx')).toBe('Hike')
    expect(sent.get('c.gpx')).toBe('Swim')
    // Undefined, not an empty string: the server reads any type it is sent as
    // the user overruling the file, so "unset" has to be absent from the form.
    expect(sent.get('b.gpx')).toBeUndefined()
  })

  // The gear and goal checks each re-read the whole library, so a batch defers
  // them and runs them once. Getting this wrong is invisible in the UI and only
  // shows up as an import that crawls.
  it('defers the post-import checks and finalizes once for a batch', async () => {
    const importSpy = vi.spyOn(api, 'importWorkout').mockResolvedValue({} as never)
    const finalizeSpy = vi.spyOn(api, 'finalizeImport').mockResolvedValue(undefined)

    await runImport([item('a.gpx'), item('b.gpx'), item('c.gpx')])

    expect(importSpy).toHaveBeenCalledTimes(3)
    for (const call of importSpy.mock.calls) expect(call[4]).toBe(true)
    expect(finalizeSpy).toHaveBeenCalledTimes(1)
  })

  // A single file should behave exactly as it did before batching existed —
  // checks inline, no extra round trip.
  it('does not defer for a single file', async () => {
    const importSpy = vi.spyOn(api, 'importWorkout').mockResolvedValue({} as never)
    const finalizeSpy = vi.spyOn(api, 'finalizeImport').mockResolvedValue(undefined)

    await runImport([item('only.gpx')])

    expect(importSpy.mock.calls[0][4]).toBe(false)
    expect(finalizeSpy).not.toHaveBeenCalled()
  })

  it('skips items that are not ready', async () => {
    const importSpy = vi.spyOn(api, 'importWorkout').mockResolvedValue({} as never)
    vi.spyOn(api, 'finalizeImport').mockResolvedValue(undefined)

    const items = [item('a.gpx'), { ...item('dup.gpx'), status: 'duplicate' as const }]
    const result = await runImport(items)

    expect(importSpy).toHaveBeenCalledTimes(1)
    expect(result.imported).toBe(1)
  })
})
