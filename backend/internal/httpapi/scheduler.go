package httpapi

import (
	"context"
	"log/slog"

	"time"
)

// dailySweepInterval is how often the time-driven notification checks run.
// Hourly rather than daily: the process is restarted often enough on a
// self-hosted box that a once-a-day timer would frequently never fire, and the
// dedupe key means the extra runs cost a query and produce nothing.
const dailySweepInterval = time.Hour

// StartScheduler runs the work that is driven by the clock rather than by a
// user action: the "a goal period is nearly over and you are short" check, and
// pruning push subscriptions nothing is behind any more. It returns when ctx is
// cancelled.
//
// This is an in-process ticker rather than a cron entry or a job queue because
// the work is a handful of queries for a handful of users; anything more would
// be infrastructure this deployment does not need.
func (s *Server) StartScheduler(ctx context.Context) {
	ticker := time.NewTicker(dailySweepInterval)
	defer ticker.Stop()

	// One pass at startup, so a restart does not skip that day's window.
	s.sweep(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweep(ctx)
		}
	}
}

func (s *Server) sweep(ctx context.Context) {
	users, err := s.auth.ListUsers(ctx)
	if err != nil {
		slog.Warn("notification sweep: could not list users", "error", err)
		return
	}
	for _, u := range users {
		if !u.IsActive {
			continue
		}
		s.checkGoalsAtRisk(ctx, u.ID)
	}

	// Cheap enough to run on the same hourly tick as everything else: one
	// indexed DELETE that matches nothing on all but a handful of passes.
	if n, err := s.notify.PruneSubscriptions(ctx); err != nil {
		slog.Warn("could not prune stale push subscriptions", "error", err)
	} else if n > 0 {
		slog.Info("pruned stale push subscriptions", "count", n)
	}
}
