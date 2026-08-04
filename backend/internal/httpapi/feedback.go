package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/feedback"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"

	"github.com/blurrycontour/go-authkit/httpmw"
)

func (s *Server) handleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Category    string `json:"category"`
		Message     string `json:"message"`
		Diagnostics string `json:"diagnostics"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	report, err := s.feedback.Create(r.Context(), user.ID, user.Username, feedback.Input{
		Category:    req.Category,
		Message:     req.Message,
		Diagnostics: req.Diagnostics,
	})
	if err != nil {
		if errors.Is(err, feedback.ErrInvalid) {
			writeError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "feedback: invalid input: "))
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save feedback")
		return
	}

	// Announced after it is safely stored, and never in a way that can fail the
	// request: the report is the thing that matters, and a submission that
	// returns an error because an admin's mail server is down would be retried
	// by the user and stored twice.
	s.announceFeedback(r.Context(), report)

	writeJSON(w, http.StatusOK, map[string]any{"feedback": report})
}

// announceFeedback tells every administrator that a report came in, in-app and
// by email where SMTP is configured.
//
// Runs in the request's context but tolerates all of its own failures. Delivery
// is best-effort by design; the admin list in the UI is the source of truth.
func (s *Server) announceFeedback(ctx context.Context, report *feedback.Report) {
	admins, err := s.auth.ListUsers(ctx)
	if err != nil {
		slog.Warn("feedback: could not load admins to notify", "error", err)
		return
	}

	title := fmt.Sprintf("New %s feedback from %s", report.Category, report.Username)
	// One line, because a notification body is a preview and the whole report is
	// one click away in Admin.
	body := firstLine(report.Message, 140)

	var emails []string
	for _, u := range admins {
		if !u.IsAdmin || !u.IsActive {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID: u.ID,
			Kind:   notify.KindFeedback,
			Title:  title,
			Body:   body,
			Link:   "/admin/feedback",
		})
		if u.Email != "" {
			emails = append(emails, u.Email)
		}
	}
	if len(emails) == 0 {
		return
	}

	mailer, err := s.mailer(ctx)
	if err != nil || !mailer.Configured() {
		// Not an error worth logging loudly: most instances have no SMTP, and
		// the in-app notification above has already done the job.
		return
	}
	emailBody := fmt.Sprintf("%s filed %s feedback:\n\n%s\n\nDiagnostics attached: %v\n",
		report.Username, report.Category, report.Message, report.HasDiagnostics)
	for _, to := range emails {
		if err := mailer.Send(ctx, to, title, emailBody); err != nil {
			slog.Warn("feedback: could not email admin", "error", err)
		}
	}
}

// firstLine trims a message to one line of at most n runes, for previews.
func firstLine(s string, n int) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = s[:i]
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}

func (s *Server) handleListFeedback(w http.ResponseWriter, r *http.Request) {
	list, err := s.feedback.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load feedback")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feedback": list})
}

// handleGetFeedback returns one report with its diagnostics. Separate from the
// listing so a page of reports never carries every attached log dump with it.
func (s *Server) handleGetFeedback(w http.ResponseWriter, r *http.Request) {
	report, err := s.feedback.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feedback": report})
}

func (s *Server) handleUpdateFeedback(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Resolved bool `json:"resolved"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.feedback.SetResolved(r.Context(), r.PathValue("id"), req.Resolved); err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteFeedback(w http.ResponseWriter, r *http.Request) {
	if err := s.feedback.Delete(r.Context(), r.PathValue("id")); err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeFeedbackError(w http.ResponseWriter, err error) {
	if errors.Is(err, feedback.ErrNotFound) {
		writeError(w, http.StatusNotFound, "feedback not found")
		return
	}
	writeError(w, http.StatusInternalServerError, "could not update feedback")
}
