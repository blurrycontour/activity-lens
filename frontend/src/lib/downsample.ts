/**
 * Reduces a time series to about `target` points while keeping its shape.
 *
 * A recorded activity samples once a second, so an hour is 3600 points — and
 * the chart drawing them is a few hundred pixels wide. Every point beyond that
 * is work with nothing to show for it: a path string that cannot be resolved,
 * rebuilt on every frame of playback, for each of six charts at once. Cutting
 * the series to what the display can actually distinguish is the single biggest
 * saving available here, and it is invisible.
 *
 * Largest-Triangle-Three-Buckets, which is the standard choice for exactly this
 * because of what naive alternatives get wrong. Taking every Nth point drops
 * peaks — the sprint, the summit, the one heart-rate spike — whenever they fall
 * between strides, and averaging each bucket flattens them into the surrounding
 * values. LTTB instead keeps, from each bucket, the point forming the largest
 * triangle with its neighbours, which is the one that contributes most to the
 * visible silhouette. Extremes survive; flat stretches collapse.
 *
 * First and last points are always kept, so the series still spans its full
 * time range and playback still reaches the end.
 */
export function downsample<T extends { t: number }>(data: T[], valueOf: (d: T) => number, target: number): T[] {
  if (target < 3 || data.length <= target) return data

  const out: T[] = [data[0]]
  // Buckets cover everything between the fixed first and last points.
  const every = (data.length - 2) / (target - 2)
  let prev = 0

  for (let i = 0; i < target - 2; i++) {
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, data.length - 1)
    const rangeStart = Math.min(Math.floor((i + 1) * every) + 1, rangeEnd)
    // The last bucket can come out empty when the target is close to the input
    // length. Falling through with an empty range left `best` at its initial
    // index, which is the final sample — appended again below, so the series
    // ended with two points at the same instant.
    if (rangeStart >= rangeEnd) continue

    // The next bucket's average stands in for "where the line is heading",
    // which is what the triangle is measured against.
    const nextStart = rangeEnd
    const nextEnd = Math.min(Math.floor((i + 3) * every) + 1, data.length)
    let avgT = 0
    let avgV = 0
    const nextCount = Math.max(nextEnd - nextStart, 1)
    for (let j = nextStart; j < nextEnd; j++) {
      avgT += data[j].t
      avgV += valueOf(data[j])
    }
    avgT /= nextCount
    avgV /= nextCount

    const prevT = data[prev].t
    const prevV = valueOf(data[prev])

    let best = rangeStart
    let bestArea = -1
    for (let j = rangeStart; j < rangeEnd; j++) {
      // Twice the triangle area, which is enough to compare by.
      const area = Math.abs((prevT - avgT) * (valueOf(data[j]) - prevV) - (prevT - data[j].t) * (avgV - prevV))
      if (area > bestArea) {
        bestArea = area
        best = j
      }
    }
    out.push(data[best])
    prev = best
  }

  out.push(data[data.length - 1])
  return out
}

/**
 * How many points to plot.
 *
 * Comfortably more than a wide chart has pixels, so the reduction can never be
 * seen, and few enough that redrawing every frame is affordable.
 */
export const PLOT_POINTS = 400
