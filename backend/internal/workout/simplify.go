package workout

import "math"

/*
 * Reducing a route to something an overview map can draw.
 *
 * A recorded track is one fix a second — a few thousand points for an hour's
 * run, of which a map showing a whole city can resolve perhaps thirty. Drawing
 * the rest costs bytes over the wire, memory in the browser and nothing at all
 * on screen, and a library of a few thousand workouts multiplies that by a few
 * thousand.
 *
 * So each workout keeps a simplified copy alongside its full route, computed
 * once at import. The full route is untouched — the workout page still draws
 * every fix, and the simplification is never the thing anyone measures.
 */

// TrackPoints is the point budget for a simplified route.
//
// Chosen against what an overview map can actually show rather than against a
// fidelity target: at typical zooms a route is a few hundred pixels across, so
// beyond roughly this many points consecutive fixes land on the same pixel. The
// tolerance search below aims for it rather than guaranteeing it, because a
// route that genuinely needs fewer should keep fewer.
const TrackPoints = 80

/*
 * SimplifyRoute reduces a route to about TrackPoints points, keeping its shape.
 *
 * Ramer–Douglas–Peucker: keep the point furthest from the line between the ends,
 * recurse on both halves, discard anything closer than the tolerance. It keeps
 * corners and drops the straights, which is exactly the trade a map wants —
 * dropping every Nth point instead would round off the turns that make a route
 * recognisable while faithfully preserving the long dull sections.
 *
 * The tolerance is found by bisection rather than fixed, because a 400 m loop
 * round a park and a 90 km ride need tolerances three orders of magnitude apart
 * and one constant cannot serve both.
 */
func SimplifyRoute(route []LatLng) []LatLng {
	if len(route) <= TrackPoints {
		return route
	}

	// Degrees, so the search brackets everything from a lap of a track to a
	// continental ride. The upper bound only has to be big enough to collapse
	// the longest plausible route to two points.
	lo, hi := 0.0, 1.0
	best := simplifyTo(route, hi)
	// Twenty halvings take the bracket from 1 degree to about a centimetre,
	// which is far finer than the data. It terminates on iteration count rather
	// than on hitting the target exactly: an L-shaped route jumps from 3 points
	// to 2 with no tolerance in between, and a loop looking for exactly 80 would
	// never end.
	for i := 0; i < 20; i++ {
		mid := (lo + hi) / 2
		got := simplifyTo(route, mid)
		if len(got) > TrackPoints {
			lo = mid
		} else {
			hi = mid
			best = got
		}
	}
	return best
}

func simplifyTo(route []LatLng, tolerance float64) []LatLng {
	if len(route) < 3 {
		return route
	}
	// Longitude degrees shrink towards the poles. Without this the tolerance
	// means something different on each axis, and the simplification is
	// noticeably harsher east–west the further from the equator a route is.
	kx := math.Cos(route[0][0] * math.Pi / 180)

	keep := make([]bool, len(route))
	keep[0] = true
	keep[len(route)-1] = true
	rdp(route, 0, len(route)-1, tolerance, kx, keep)

	out := make([]LatLng, 0, TrackPoints)
	for i, k := range keep {
		if k {
			out = append(out, route[i])
		}
	}
	return out
}

// rdp marks the points worth keeping between first and last.
//
// An explicit stack rather than recursion: a route is user-supplied and can be
// tens of thousands of points, and the worst case for this algorithm is a
// recursion one frame deep per point.
func rdp(route []LatLng, first, last int, tolerance, kx float64, keep []bool) {
	type span struct{ a, b int }
	stack := []span{{first, last}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if s.b <= s.a+1 {
			continue
		}
		furthest, maxDist := -1, tolerance
		for i := s.a + 1; i < s.b; i++ {
			if d := perpDistance(route[i], route[s.a], route[s.b], kx); d > maxDist {
				furthest, maxDist = i, d
			}
		}
		if furthest < 0 {
			continue
		}
		keep[furthest] = true
		stack = append(stack, span{s.a, furthest}, span{furthest, s.b})
	}
}

// perpDistance is the distance from p to the segment ab, in scaled degrees.
func perpDistance(p, a, b LatLng, kx float64) float64 {
	px, py := (p[1]-a[1])*kx, p[0]-a[0]
	bx, by := (b[1]-a[1])*kx, b[0]-a[0]
	den := bx*bx + by*by
	if den == 0 {
		// A degenerate segment — the route doubled back on the same fix — so
		// the distance to the segment is the distance to the point.
		return math.Hypot(px, py)
	}
	// Clamped, so a point beyond either end measures to the endpoint rather
	// than to the infinite line, which would keep points that are nowhere near
	// the segment.
	t := (px*bx + py*by) / den
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(px-t*bx, py-t*by)
}

// Bounds is the rectangle a route occupies.
type Bounds struct {
	MinLat, MaxLat, MinLon, MaxLon float64
}

// Ok reports whether these bounds came from a real route. The zero value is
// what every row gets from the migration, and it is also a legitimate point in
// the Gulf of Guinea — so "has a box" is asked rather than assumed.
func (b Bounds) Ok() bool {
	return b.MinLat != 0 || b.MaxLat != 0 || b.MinLon != 0 || b.MaxLon != 0
}

// RouteBounds measures a route, skipping the null-island fixes a GPS emits
// before it has a lock. A route of nothing but those has no bounds at all.
func RouteBounds(route []LatLng) Bounds {
	b := Bounds{MinLat: math.Inf(1), MaxLat: math.Inf(-1), MinLon: math.Inf(1), MaxLon: math.Inf(-1)}
	n := 0
	for _, p := range route {
		lat, lon := p[0], p[1]
		if lat == 0 && lon == 0 {
			continue
		}
		if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}
		n++
		b.MinLat = math.Min(b.MinLat, lat)
		b.MaxLat = math.Max(b.MaxLat, lat)
		b.MinLon = math.Min(b.MinLon, lon)
		b.MaxLon = math.Max(b.MaxLon, lon)
	}
	if n == 0 {
		return Bounds{}
	}
	return b
}
