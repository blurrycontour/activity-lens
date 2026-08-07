import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Share2, X } from 'lucide-react'
import { type Workout } from '../data/workouts'
import {
  CARD_H, CARD_W, cardFilename, drawShareCard, encodeCard, themeFromDocument,
  type CardFormat,
} from '../lib/shareCard'
import { reportSaveFailure, shareFile } from '../lib/download'
import { isNative } from '../lib/serverConfig'

/**
 * A workout as a picture, for sending to people who do not have an account.
 *
 * The card is drawn once when the dialog opens and shown as a real preview
 * rather than an approximation of one: what you see is the file, so there is
 * nothing to be surprised by after sending it. The canvas is scaled down with
 * CSS, which is why it carries an explicit width and height — the bitmap stays
 * at full resolution for the export.
 */
export default function ShareCardDialog({ workout, onClose }: {
  workout: Workout
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<CardFormat | 'share' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return
    drawShareCard(canvas, workout, themeFromDocument())
      .then(() => { if (alive) setReady(true) })
      .catch(() => { if (alive) setNote('Could not draw the card.') })
    return () => { alive = false }
  }, [workout])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(what: CardFormat | 'share') {
    if (!canvasRef.current) return
    setBusy(what)
    setNote(null)
    try {
      // PNG for sharing: it is lossless, every platform accepts it, and a card
      // is flat colour and text, which is the case JPEG handles worst.
      const format: CardFormat = what === 'share' ? 'png' : what
      const blob = await encodeCard(canvasRef.current, format)
      const name = cardFilename(workout, format)
      if (what === 'share') {
        const shared = await shareFile(name, blob, { title: workout.name })
        // Said only when it fell back, so "Saved" never appears over a share
        // sheet that did open.
        if (!shared) setNote('No share sheet here — saved the image instead.')
      } else {
        const { saveFile } = await import('../lib/download')
        await saveFile(name, blob)
      }
    } catch (err) {
      reportSaveFailure(err)
      setNote('Could not save the image.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-box share-card-modal" role="dialog" aria-modal="true" aria-label="Share card">
        <div className="share-card-head">
          <h3 className="share-card-title">Share card</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Sized by aspect ratio rather than by the canvas, so the dialog does
            not resize when the image lands. */}
        <div className="share-card-preview" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}>
          {/* Always mounted, so the effect has something to draw on and React
              keeps ownership of every node in here. Hidden until it has been
              painted rather than swapped in afterwards. */}
          <canvas
            ref={canvasRef}
            className="share-card-canvas"
            style={{ opacity: ready ? 1 : 0 }}
            aria-label={`Share card for ${workout.name}`}
          />
          {!ready && <Loader2 size={20} className="spin" style={{ position: 'absolute' }} />}
        </div>

        {note && <p className="share-card-note">{note}</p>}

        <div className="share-card-actions">
          <button className="btn btn-primary" disabled={!ready || busy !== null} onClick={() => void run('share')}>
            {busy === 'share'
              ? <><Loader2 size={14} className="spin" /> Preparing…</>
              : <><Share2 size={14} /> Share</>}
          </button>
          {/* Both formats offered rather than one chosen for the user: PNG is
              the better image, JPEG is what some older upload forms accept. */}
          <button className="btn btn-ghost" disabled={!ready || busy !== null} onClick={() => void run('png')}>
            <Download size={14} /> PNG
          </button>
          <button className="btn btn-ghost" disabled={!ready || busy !== null} onClick={() => void run('jpeg')}>
            <Download size={14} /> JPEG
          </button>
        </div>
        {!isNative() && (
          <p className="share-card-hint">
            Sharing uses your browser's share sheet where it has one, and saves
            the image where it does not.
          </p>
        )}
      </div>
    </>
  )
}
