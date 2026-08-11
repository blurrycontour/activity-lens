/**
 * Shrinking a photo in the browser before it is uploaded.
 *
 * The server re-encodes everything it is given anyway — that is what strips the
 * EXIF, which on a phone photo carries the coordinates it was taken at — so
 * this is not what makes the stored file small. What it makes small is the
 * *upload*: a modern phone photo is 4–8 MB and this sends about 400 KB of it,
 * which on a mobile connection is the difference between an upload that feels
 * instant and one you watch.
 *
 * Never trusted. The server enforces its own limits and does its own
 * processing, because this runs on the client and a client can be anything.
 */

/** Longest side of an uploaded photo. Comfortably above what the server keeps. */
const MAX_UPLOAD_DIM = 2400

/** JPEG quality. High enough that the server's own re-encode has room to work. */
const QUALITY = 0.86

/** Below this there is nothing to gain, and re-encoding would only lose. */
const SKIP_BELOW_BYTES = 400 * 1024

/**
 * Returns a smaller JPEG of `file`, or the file unchanged when shrinking it
 * would not help.
 *
 * Falls back to the original on any failure. Every one of them — a format the
 * canvas cannot decode, a browser with the canvas locked down, an image too
 * large to rasterise — leaves a perfectly uploadable file in hand, and refusing
 * the upload over a failed optimisation would be the wrong trade.
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  if (file.size <= SKIP_BELOW_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, MAX_UPLOAD_DIM / Math.max(bitmap.width, bitmap.height))
      const w = Math.round(bitmap.width * scale)
      const h = Math.round(bitmap.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, w, h)

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', QUALITY))
      // A "shrink" that made the file bigger is not one. This happens on a
      // photo that was already well compressed at a size the scale left alone.
      if (!blob || blob.size >= file.size) return file
      return blob
    } finally {
      // Released explicitly: a decoded 12-megapixel bitmap is ~48 MB, and on a
      // phone uploading several photos in a row that adds up fast.
      bitmap.close()
    }
  } catch {
    return file
  }
}

/**
 * The name to upload under, with the extension corrected when the bytes were
 * re-encoded. Only used as a label, but a JPEG called ".heic" is a confusing
 * one to see in a caption.
 */
export function uploadName(file: File, shrunk: Blob): string {
  if (shrunk === (file as Blob)) return file.name
  return file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
}
