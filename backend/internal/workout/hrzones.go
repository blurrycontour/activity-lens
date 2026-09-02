package workout

import (
	"context"
	"fmt"
)

// HRZoneBoundsBpm returns the four heart-rate boundaries (bpm) between the five
// zones — the 60/70/80/90% split. Karvonen measures the percentage against the
// reserve above resting; otherwise it is a percentage of max alone. Mirrors the
// frontend's lib/hrZones so a workout's own chart and this summary agree.
func HRZoneBoundsBpm(maxHR, restingHR int, method string) [4]int {
	at := func(f float64) int {
		if method == "reserve" && restingHR > 0 && restingHR < maxHR {
			return int(float64(restingHR) + f*float64(maxHR-restingHR) + 0.5)
		}
		return int(f*float64(maxHR) + 0.5)
	}
	return [4]int{at(0.6), at(0.7), at(0.8), at(0.9)}
}

// HRZoneCounts returns, per workout id, how many heart-rate samples fell in each
// of the five zones for this athlete's ceiling and model.
//
// The whole library is summarised in one call so the Analysis page fetches it
// once and does its own date/type filtering on the client — switching filters
// then costs no server work at all. The heavy part, decompressing each stored
// HR series, happens a workout at a time in the repository rather than holding
// the library in memory.
func (s *Service) HRZoneCounts(ctx context.Context, userID int64, maxHR, restingHR int, method string) (map[string][5]int, error) {
	if maxHR <= 0 {
		return map[string][5]int{}, nil
	}
	return s.repo.HRZoneCounts(ctx, userID, HRZoneBoundsBpm(maxHR, restingHR, method))
}

// HRZoneCounts buckets every workout's heart-rate samples into the five zones,
// given the four bpm boundaries between them. One workout's series is decoded
// at a time, so the library is never all in memory at once.
func (r *SQLiteRepository) HRZoneCounts(ctx context.Context, userID int64, bounds [4]int) (map[string][5]int, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, hr_timeline FROM workouts WHERE user_id = ? AND max_hr > 0`, userID)
	if err != nil {
		return nil, fmt.Errorf("query hr timelines: %w", err)
	}
	defer rows.Close()

	out := make(map[string][5]int)
	for rows.Next() {
		var id string
		var blob []byte
		if err := rows.Scan(&id, &blob); err != nil {
			return nil, fmt.Errorf("scan hr timeline: %w", err)
		}
		var hr []HRPoint
		if err := unmarshalInto(blob, &hr); err != nil {
			return nil, err
		}
		if len(hr) == 0 {
			continue
		}
		var c [5]int
		for _, p := range hr {
			z := 0
			for z < 4 && p.HR >= bounds[z] {
				z++
			}
			c[z]++
		}
		out[id] = c
	}
	return out, rows.Err()
}
