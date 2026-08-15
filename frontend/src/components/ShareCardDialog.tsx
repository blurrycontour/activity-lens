import { useEffect, useRef, useState } from 'react'
import { Download, Heart, Loader2, MapPin, Share2, X } from 'lucide-react'
import { type Workout } from '../data/workouts'
import {
  CARD_W, cardFilename, cardHeight, drawShareCard, encodeCard, themeFromDocument,
  type CardFormat, type CardTitleMode,
} from '../lib/shareCard'
import { reportSaveFailure, shareFile } from '../lib/download'
import { isNative } from '../lib/serverConfig'
import { api } from '../lib/api'
import Modal from './Modal'

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
  // The sport by default: it is what a stranger needs to read the rest of the
  // card, and a device-generated name like "Afternoon Run 3" says less than the
  // word "Run" does. A name someone actually chose is worth showing, hence the
  // toggle rather than a decision made for them.
  const [titleMode, setTitleMode] = useState<CardTitleMode>('type')
  /**
   * What to leave off.
   *
   * Both default to on, because the card is a picture of a workout and those
   * are part of it. They are worth being able to drop for two different
   * reasons: a route drawn from your front door is the most identifying thing
   * on the card, and a workout with no GPS spends half its height on a panel
   * saying so.
   */
  const [showRoute, setShowRoute] = useState(true)
  const [showHR, setShowHR] = useState(true)

  /**
   * The workout with its route attached.
   *
   * The list endpoint returns summaries with `route` stripped, so a card opened
   * from the workouts list would draw a perfectly convincing picture with the
   * route missing. Fetching here rather than at each call site keeps that from
   * depending on which page the dialog was opened from.
   */
  const [full, setFull] = useState(workout)
  useEffect(() => {
    setFull(workout)
    // Length, not truthiness: the summary endpoint sends `route: []` rather
    // than omitting it, and an empty array is truthy — which is what made the
    // first version of this skip the fetch and draw an empty route anyway.
    if (workout.route?.length) return
    let alive = true
    // A workout genuinely without a route — a treadmill run, a gym session —
    // resolves to the same thing, so there is nothing to handle separately.
    api.getWorkout(workout.id)
      .then(w => { if (alive) setFull(w) })
      .catch(() => { if (alive) setNote('Could not load the route for this card.') })
    return () => { alive = false }
  }, [workout])

  useEffect(() => {
    let alive = true
    const canvas = canvasRef.current
    if (!canvas) return
    setReady(false)
    drawShareCard(canvas, full, themeFromDocument(), { titleMode, showRoute, showHR })
      .then(() => { if (alive) setReady(true) })
      .catch(() => { if (alive) setNote('Could not draw the card.') })
    return () => { alive = false }
  }, [full, titleMode, showRoute, showHR])

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
    <Modal onClose={onClose} label="Share card">
        <div className="modal-box share-card-modal">
          <div className="share-card-head">
            <h3 className="share-card-title">Share card</h3>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          {/* Sized by aspect ratio rather than by the canvas, so the dialog does
              not resize when the image lands. */}
          <div
            className="share-card-preview"
            style={{ aspectRatio: `${CARD_W} / ${cardHeight(full, { showRoute, showHR })}` }}
          >
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

          {/* Redraws rather than swapping a caption: the title changes the width
              of the headline, and the preview is meant to be the file. */}
          <div className="share-card-titles" role="group" aria-label="Card title">
            <span className="share-card-titles-label">Title</span>
            {([
              { id: 'type' as CardTitleMode, label: 'Activity type' },
              { id: 'name' as CardTitleMode, label: 'Workout name' },
            ]).map(o => (
              <button
                key={o.id}
                className={`chip${titleMode === o.id ? ' active' : ''}`}
                aria-pressed={titleMode === o.id}
                onClick={() => setTitleMode(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* What is on the card, as switches rather than a menu: there are two
              of them and the preview answers immediately. Heart rate is offered
              only when there is one — a switch that removes nothing reads as
              broken. */}
          <div className="share-card-titles" role="group" aria-label="What to show">
            <span className="share-card-titles-label">Show</span>
            <button
              className={`chip${showRoute ? ' active' : ''}`}
              aria-pressed={showRoute}
              onClick={() => setShowRoute(v => !v)}
            >
              <MapPin size={13} /> Route
            </button>
            {full.avgHR > 0 && (
              <button
                className={`chip${showHR ? ' active' : ''}`}
                aria-pressed={showHR}
                onClick={() => setShowHR(v => !v)}
              >
                <Heart size={13} /> Heart rate
              </button>
            )}
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
    </Modal>
  )
}
