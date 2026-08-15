package httpapi

import (
	"context"
	"log/slog"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// annotateFlags fills in the counts a list can be filtered by but a row does
// not carry: how many photos and how many comments each workout has.
//
// Two queries for the whole list, and best effort. A failure leaves the counts
// at zero, which reads as "no photos" — worth it against failing an entire
// library over a filter's worth of metadata, and the same bargain the share
// counts beside it already make.
func (s *Server) annotateFlags(ctx context.Context, list []workout.Workout) {
	if len(list) == 0 {
		return
	}
	ids := make([]string, len(list))
	for i := range list {
		ids[i] = list[i].ID
	}
	flags, err := s.workout.FlagsFor(ctx, ids)
	if err != nil {
		slog.Warn("could not load list flags", "error", err)
		return
	}
	for i := range list {
		f := flags[list[i].ID]
		list[i].PhotoCount = f.Media
		list[i].CommentCount = f.Comments
	}
}
