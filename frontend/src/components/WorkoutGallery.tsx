import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2, X as XIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import ConfirmDialog from './ConfirmDialog'
import { api, ApiError, type WorkoutPhoto } from '../lib/api'
import { shrinkForUpload, uploadName } from '../lib/photoResize'
import useDismissOnBack from '../lib/useDismissOnBack'

/**
 * Photos attached to a workout.
 *
 * Mounted only when its tab is opened — see WorkoutDetail's lazy import — so a
 * workout with no photos costs one request nobody made, and the bytes are only
 * ever fetched for a gallery someone is looking at.
 *
 * Each image is fetched rather than pointed at with an <img src>. They are
 * behind authentication, and the native app authenticates with a bearer token
 * that an <img> would never send; going through the API client is the one path
 * that works in the browser and in the app without a second story for each.
 */

interface WorkoutGalleryProps {
  workoutId: string
  /** Only the owner may add or remove; everyone who can see the workout looks. */
  canEdit: boolean
  /**
   * How many photos there turned out to be, so the tab that opened this can
   * keep its badge honest after an upload or a delete.
   *
   * Reported from an effect on the list rather than from each mutation, so a
   * path that changes `photos` without remembering to call it cannot exist.
   * Must be stable across renders — it is an effect dependency.
   */
  onCount?: (n: number) => void
}

export default function WorkoutGallery({ workoutId, canEdit, onCount }: WorkoutGalleryProps) {
  const [photos, setPhotos] = useState<WorkoutPhoto[] | null>(null)
  const [max, setMax] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [viewing, setViewing] = useState<WorkoutPhoto | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WorkoutPhoto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.workoutPhotos(workoutId)
      setPhotos(res.media)
      setMax(res.max)
      setError(null)
    } catch (err) {
      setPhotos([])
      setError(err instanceof ApiError ? err.message : 'Could not load the gallery.')
    }
  }, [workoutId])

  useEffect(() => { void load() }, [load])

  // Null is "not loaded", which is not a count of anything.
  useEffect(() => { if (photos) onCount?.(photos.length) }, [photos, onCount])

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    // Sequential, not parallel. Each upload is a full-size decode and re-encode
    // on the server, and firing eight at a self-hosted box at once is how a
    // gallery upload becomes a request everyone else is waiting behind.
    const list = Array.from(files)
    setUploading(list.length)
    for (const file of list) {
      try {
        const shrunk = await shrinkForUpload(file)
        const saved = await api.uploadWorkoutPhoto(workoutId, shrunk, uploadName(file, shrunk))
        setPhotos(prev => [...(prev ?? []), saved])
      } catch (err) {
        setError(err instanceof ApiError ? err.message : `Could not add ${file.name}.`)
        break
      } finally {
        setUploading(n => Math.max(0, n - 1))
      }
    }
    setUploading(0)
    // Cleared so picking the same file again still fires a change event.
    if (fileInput.current) fileInput.current.value = ''
  }

  async function remove(photo: WorkoutPhoto) {
    setDeleting(true)
    try {
      await api.deleteWorkoutPhoto(workoutId, photo.id)
      setPhotos(prev => (prev ?? []).filter(p => p.id !== photo.id))
      setConfirmDelete(null)
      setViewing(v => (v?.id === photo.id ? null : v))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that photo.')
    } finally {
      setDeleting(false)
    }
  }

  const full = (photos?.length ?? 0) >= max

  return (
    <div className="gallery">
      {canEdit && (
        <div className="gallery-actions">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={e => void addFiles(e.target.files)}
          />
          <button
            className="btn btn-ghost"
            disabled={uploading > 0 || full}
            onClick={() => fileInput.current?.click()}
          >
            {uploading > 0
              ? <><LoaderCircle size={15} className="spin" /> Adding {uploading}…</>
              : <><ImagePlus size={15} /> Add photos</>}
          </button>
          <span className="gallery-count">
            {photos ? `${photos.length} of ${max}` : ''}
          </span>
        </div>
      )}

      {error && <p className="gallery-error">{error}</p>}

      {photos === null && (
        <div className="gallery-empty"><LoaderCircle size={18} className="spin" /></div>
      )}

      {photos !== null && photos.length === 0 && (
        <p className="gallery-empty">
          {canEdit
            ? 'No photos yet. Add one from the button above.'
            : 'No photos on this workout.'}
        </p>
      )}

      {photos !== null && photos.length > 0 && (
        <ul className="gallery-grid">
          {photos.map(p => (
            <li key={p.id}>
              <button className="gallery-tile" onClick={() => setViewing(p)} title={p.caption || p.filename}>
                <GalleryImage workoutId={workoutId} photo={p} thumb />
              </button>
              {canEdit && (
                <button
                  className="gallery-tile-remove"
                  onClick={() => setConfirmDelete(p)}
                  title="Delete photo"
                  aria-label="Delete photo"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <Lightbox
          workoutId={workoutId}
          photo={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this photo?"
          message="It is removed from this workout for everyone it is shared with. This cannot be undone."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/**
 * One photo, fetched when it comes near the viewport.
 *
 * An IntersectionObserver rather than the <img loading="lazy"> attribute,
 * because that attribute only works on an element with a src — and the src here
 * is a blob built from an authenticated fetch, so nothing exists to be lazy
 * about until the fetch has happened.
 */
function GalleryImage({ workoutId, photo, thumb }: {
  workoutId: string
  photo: WorkoutPhoto
  thumb: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(!thumb)

  useEffect(() => {
    if (near || !box.current) return
    const el = box.current
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setNear(true)
        obs.disconnect()
      }
      // A generous margin, so a tile is already loaded by the time it is
      // scrolled to rather than starting to load as it arrives.
    }, { rootMargin: '300px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [near])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let objectUrl: string | null = null
    api.workoutPhoto(workoutId, photo.id, thumb)
      .then(file => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(file.blob)
        setUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      // Revoked on unmount, or a gallery scrolled through leaks every photo it
      // ever showed for as long as the page is open.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [near, workoutId, photo.id, thumb])

  return (
    <div
      ref={box}
      className="gallery-img"
      // From the stored dimensions, so the grid does not reflow as each photo
      // arrives — the layout is right before a single byte is fetched.
      style={{ aspectRatio: photo.width > 0 && photo.height > 0 ? `${photo.width} / ${photo.height}` : '4 / 3' }}
    >
      {url && <img src={url} alt={photo.caption || ''} />}
      {!url && !failed && <LoaderCircle size={16} className="spin" />}
      {failed && <span className="gallery-img-failed">Unavailable</span>}
    </div>
  )
}

/** The full-size view, over everything. */
function Lightbox({ workoutId, photo, onClose }: {
  workoutId: string
  photo: WorkoutPhoto
  onClose: () => void
}) {
  // Escape and the back gesture both come from here.
  useDismissOnBack(true, onClose)

  // Portalled, because the page lives inside the swipe pager, which is a
  // stacking context — no z-index from in here can get above the top and
  // bottom bars without leaving it.
  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="Photo">
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><XIcon size={18} /></button>
      <div className="lightbox-body" onClick={e => e.stopPropagation()}>
        <GalleryImage workoutId={workoutId} photo={photo} thumb={false} />
        {photo.caption && <p className="lightbox-caption">{photo.caption}</p>}
      </div>
    </div>,
    document.body,
  )
}
