/**
 * The finish flag, as geometry rather than as markup.
 *
 * Two things draw it and they cannot share a renderer: the workout map builds
 * an SVG string for a MapLibre marker, and the share card strokes it onto a
 * canvas. The paths live here so the flag on the card is the same flag as the
 * one on the map, instead of a second drawing of the same idea that drifts the
 * first time either is adjusted.
 *
 * Both are in a 24×24 box with the pole's foot at (6, 21), which is the point
 * that goes on the route's last fix.
 */

/** The pole. */
export const FINISH_POLE_D = 'M6 21V4'
/** The pennant, filled in the danger colour. */
export const FINISH_FLAG_D = 'M6 5h11l-2.2 3.3L17 12H6z'

/** Where the pole's foot sits inside the 24×24 box. */
export const FINISH_ANCHOR: [number, number] = [6, 21]
export const FINISH_BOX = 24
