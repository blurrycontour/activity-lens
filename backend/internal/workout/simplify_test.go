package workout

import (
	"math"
	"testing"
)

// A straight line is entirely redundant: every interior point lies exactly on
// the segment between its neighbours, so nothing but the ends should survive.
func TestSimplifyCollapsesAStraightLine(t *testing.T) {
	route := make([]LatLng, 500)
	for i := range route {
		route[i] = LatLng{51.5 + float64(i)*0.0001, -0.12}
	}
	got := SimplifyRoute(route)
	if len(got) != 2 {
		t.Errorf("kept %d points of a straight line, want 2", len(got))
	}
}

// The whole point of Douglas-Peucker over "keep every Nth point": corners are
// what make a route recognisable, and a route is mostly not corners.
func TestSimplifyKeepsCorners(t *testing.T) {
	// A square, densely sampled along each side.
	corners := []LatLng{{51.50, -0.12}, {51.50, -0.10}, {51.52, -0.10}, {51.52, -0.12}, {51.50, -0.12}}
	var route []LatLng
	for i := 0; i+1 < len(corners); i++ {
		a, b := corners[i], corners[i+1]
		for s := 0; s < 200; s++ {
			f := float64(s) / 200
			route = append(route, LatLng{a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f})
		}
	}
	route = append(route, corners[len(corners)-1])

	got := SimplifyRoute(route)
	if len(got) > TrackPoints {
		t.Fatalf("kept %d points, want at most %d", len(got), TrackPoints)
	}
	// Every corner has to appear in the output, within a metre or so.
	for _, c := range corners {
		found := false
		for _, p := range got {
			if math.Abs(p[0]-c[0]) < 1e-5 && math.Abs(p[1]-c[1]) < 1e-5 {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("corner %v was simplified away — the route is no longer recognisable", c)
		}
	}
}

func TestSimplifyRespectsTheBudget(t *testing.T) {
	// A wandering route with no straight sections to exploit, which is the case
	// that pushes back hardest against the point budget.
	route := make([]LatLng, 4000)
	for i := range route {
		f := float64(i)
		route[i] = LatLng{51.5 + math.Sin(f/7)*0.01, -0.12 + math.Cos(f/11)*0.01}
	}
	got := SimplifyRoute(route)
	if len(got) > TrackPoints {
		t.Errorf("kept %d points, want at most %d", len(got), TrackPoints)
	}
	if len(got) < 10 {
		t.Errorf("kept only %d points of a wandering route — the shape is gone", len(got))
	}
	// Ends are anchors: a track that starts or finishes somewhere else is wrong
	// in a way that looks fine.
	if got[0] != route[0] || got[len(got)-1] != route[len(route)-1] {
		t.Error("simplification moved the start or the finish")
	}
}

// Short routes are already drawable and must not be touched.
func TestSimplifyLeavesShortRoutesAlone(t *testing.T) {
	route := []LatLng{{51.5, -0.12}, {51.51, -0.11}, {51.52, -0.10}}
	got := SimplifyRoute(route)
	if len(got) != len(route) {
		t.Errorf("kept %d of %d points", len(got), len(route))
	}
	for _, n := range []int{0, 1, 2} {
		if got := SimplifyRoute(route[:n]); len(got) != n {
			t.Errorf("SimplifyRoute of %d points returned %d", n, len(got))
		}
	}
}

// Every point identical: the perpendicular distance is 0/0 unless guarded, and
// NaN propagates into a track that draws nothing at all.
func TestSimplifySurvivesADegenerateRoute(t *testing.T) {
	route := make([]LatLng, 300)
	for i := range route {
		route[i] = LatLng{51.5, -0.12}
	}
	for _, p := range SimplifyRoute(route) {
		if math.IsNaN(p[0]) || math.IsNaN(p[1]) {
			t.Fatal("simplification produced NaN coordinates")
		}
	}
}

func TestRouteBounds(t *testing.T) {
	b := RouteBounds([]LatLng{{51.5, -0.12}, {51.52, -0.10}, {51.49, -0.15}})
	if b.MinLat != 51.49 || b.MaxLat != 51.52 || b.MinLon != -0.15 || b.MaxLon != -0.10 {
		t.Errorf("bounds = %+v", b)
	}
	if !b.Ok() {
		t.Error("real bounds reported as absent")
	}
}

// A GPS emits (0,0) until it has a lock. Including those stretches the box
// across half the planet, which on the map puts the workout in the Atlantic and
// makes it match every viewport there is.
func TestRouteBoundsIgnoresFixesBeforeALock(t *testing.T) {
	b := RouteBounds([]LatLng{{0, 0}, {0, 0}, {51.5, -0.12}, {51.52, -0.10}})
	if b.MinLat != 51.5 || b.MaxLat != 51.52 {
		t.Errorf("bounds = %+v, want only the real fixes", b)
	}
}

func TestRouteBoundsOfNothingIsAbsent(t *testing.T) {
	for _, route := range [][]LatLng{
		nil,
		{},
		{{0, 0}, {0, 0}},
		{{91, 0}, {0, 181}},
	} {
		if b := RouteBounds(route); b.Ok() {
			t.Errorf("RouteBounds(%v) = %+v, want absent", route, b)
		}
	}
}
