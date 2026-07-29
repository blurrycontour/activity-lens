import { describe, expect, it } from 'vitest'
import { isGatewayError, respondedFromBackend } from '../network'
import { FROM_CACHE_HEADER } from '../swCache'

/**
 * Reachability regressed three times in a row, each time because a new way of
 * "the backend is down" was not recognised: a thrown fetch behind a dev tunnel,
 * a service-worker cache hit, and finally a 502 from a reverse proxy that was
 * itself perfectly healthy. These pin all three shapes.
 */

function res(status: number, fromCache = false): Response {
  return new Response(null, {
    status,
    headers: fromCache ? { [FROM_CACHE_HEADER]: '1' } : {},
  })
}

describe('isGatewayError', () => {
  it('flags statuses an intermediary returns when it cannot reach the origin', () => {
    for (const s of [502, 503, 504, 521, 522, 523, 524]) {
      expect(isGatewayError(s), `status ${s}`).toBe(true)
    }
  })

  it('does not flag statuses the app itself produced', () => {
    // 500 matters most: the app errored, which is a bug — but it IS reachable,
    // and showing an offline banner for it would send the user chasing their
    // network instead of reporting it.
    for (const s of [200, 201, 204, 400, 401, 403, 404, 409, 500]) {
      expect(isGatewayError(s), `status ${s}`).toBe(false)
    }
  })
})

describe('respondedFromBackend', () => {
  it('accepts a normal response off the network', () => {
    expect(respondedFromBackend(res(200))).toBe(true)
  })

  it('accepts an error the app itself returned', () => {
    expect(respondedFromBackend(res(401))).toBe(true)
    expect(respondedFromBackend(res(500))).toBe(true)
  })

  it('rejects a service-worker cache hit', () => {
    expect(respondedFromBackend(res(200, true))).toBe(false)
  })

  it('rejects a gateway error from a healthy proxy', () => {
    expect(respondedFromBackend(res(502))).toBe(false)
  })
})
