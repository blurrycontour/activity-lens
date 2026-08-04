// Package feedback owns user-submitted reports and the diagnostics that may be
// attached to them.
//
// It is deliberately dumb about delivery: it stores a report and returns it.
// Telling anyone — a notification to the admins, an email — is the caller's job,
// because those depend on services (notify, mail) that this package would
// otherwise have to know about, and a failure to notify must never be a reason
// to lose the report itself.
package feedback

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalid is returned for validation failures on caller-supplied input.
var ErrInvalid = errors.New("feedback: invalid input")

// ErrNotFound is returned when a report does not exist.
var ErrNotFound = errors.New("feedback: not found")

// Category is the coarse kind of report, chosen by the person filing it.
type Category string

// Supported categories.
const (
	CategoryBug   Category = "bug"
	CategoryIdea  Category = "idea"
	CategoryOther Category = "other"
)

// AllCategories is every category, in the order the form lists them.
var AllCategories = []Category{CategoryBug, CategoryIdea, CategoryOther}

func normalizeCategory(c string) Category {
	for _, v := range AllCategories {
		if string(v) == strings.ToLower(strings.TrimSpace(c)) {
			return v
		}
	}
	return CategoryOther
}

/*
maxMessageRunes and maxDiagnosticsBytes bound what one submission can cost.

Feedback is the only endpoint where an authenticated user hands over free text
of their choosing and we keep it forever, so it needs a ceiling that is not
"whatever the request body limit happens to be". The message bound is generous
for prose; the diagnostics bound fits a few hundred log lines and the device
description, and anything larger is a runaway loop rather than a useful report.
*/
const (
	maxMessageRunes     = 5000
	maxDiagnosticsBytes = 256 * 1024
)

// Report is one submission.
type Report struct {
	ID     string `json:"id"`
	UserID int64  `json:"-"`
	// Username at the time of submission, so a listing needs no join.
	Username string   `json:"username"`
	Category Category `json:"category"`
	Message  string   `json:"message"`
	// Diagnostics is the JSON blob the client attached, verbatim, or empty when
	// the user chose not to attach one. Stored as text and never parsed here:
	// its shape is the client's business and it changes with the client.
	Diagnostics string `json:"diagnostics,omitempty"`
	// Whether a blob is attached at all, so a listing can show which reports
	// have one without carrying any of them.
	HasDiagnostics bool       `json:"hasDiagnostics"`
	ResolvedAt     *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// Input is what a caller may set when filing a report.
type Input struct {
	Category    string
	Message     string
	Diagnostics string
}

// Repository is the persistence seam for feedback.
type Repository interface {
	Create(ctx context.Context, r *Report) error
	// List returns reports newest first. withDiagnostics false omits the blob,
	// which is the bulk of the row and is not shown in a listing.
	List(ctx context.Context, withDiagnostics bool) ([]Report, error)
	Get(ctx context.Context, id string) (*Report, error)
	SetResolved(ctx context.Context, id string, resolved bool) error
	Delete(ctx context.Context, id string) error
	// DeleteAllForUser removes every report a user filed, for cleanup when that
	// account is deleted.
	DeleteAllForUser(ctx context.Context, userID int64) error
}

// Service holds the rules on top of a Repository.
type Service struct{ repo Repository }

// NewService builds a feedback service.
func NewService(repo Repository) *Service { return &Service{repo: repo} }

// Create validates and stores a report.
func (s *Service) Create(ctx context.Context, userID int64, username string, in Input) (*Report, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" {
		return nil, fmt.Errorf("%w: message is required", ErrInvalid)
	}
	if len([]rune(message)) > maxMessageRunes {
		return nil, fmt.Errorf("%w: message is too long", ErrInvalid)
	}
	if len(in.Diagnostics) > maxDiagnosticsBytes {
		return nil, fmt.Errorf("%w: attached diagnostics are too large", ErrInvalid)
	}
	r := &Report{
		ID:          newID(),
		UserID:      userID,
		Username:    username,
		Category:    normalizeCategory(in.Category),
		Message:     message,
		Diagnostics: in.Diagnostics,
		CreatedAt:   time.Now().UTC(),
	}
	if err := s.repo.Create(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

// List returns every report, newest first, without diagnostics blobs.
func (s *Service) List(ctx context.Context) ([]Report, error) {
	return s.repo.List(ctx, false)
}

// Get returns one report including its diagnostics.
func (s *Service) Get(ctx context.Context, id string) (*Report, error) {
	return s.repo.Get(ctx, id)
}

// SetResolved marks a report dealt with, or puts it back.
func (s *Service) SetResolved(ctx context.Context, id string, resolved bool) error {
	return s.repo.SetResolved(ctx, id, resolved)
}

// Delete removes a report permanently.
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

// PurgeUser removes every report a user filed.
func (s *Service) PurgeUser(ctx context.Context, userID int64) error {
	return s.repo.DeleteAllForUser(ctx, userID)
}

func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing is not a condition a report can recover from, and
		// a predictable id here would be worse than none.
		panic("feedback: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// SQLiteRepository implements Repository on *sql.DB. The SQL is plain enough to
// run unchanged on Postgres apart from placeholders, which is the same bargain
// every other repository here makes.
type SQLiteRepository struct{ db *sql.DB }

// NewSQLiteRepository builds a SQLite-backed feedback repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

func (r *SQLiteRepository) Create(ctx context.Context, rep *Report) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO feedback (id, user_id, username, category, message, diagnostics, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		rep.ID, rep.UserID, rep.Username, string(rep.Category), rep.Message,
		nullIfEmpty(rep.Diagnostics), rep.CreatedAt)
	if err != nil {
		return fmt.Errorf("feedback: create: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) List(ctx context.Context, withDiagnostics bool) ([]Report, error) {
	// The diagnostics column is selected as a constant when it is not wanted,
	// so a listing never pulls kilobytes per row off disk to discard them.
	diagnostics := "''"
	if withDiagnostics {
		diagnostics = "COALESCE(diagnostics, '')"
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, user_id, username, category, message, `+diagnostics+`,
		        diagnostics IS NOT NULL, resolved_at, created_at
		   FROM feedback ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("feedback: list: %w", err)
	}
	defer rows.Close()
	out := []Report{}
	for rows.Next() {
		rep, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rep)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) Get(ctx context.Context, id string) (*Report, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, username, category, message, COALESCE(diagnostics, ''),
		        diagnostics IS NOT NULL, resolved_at, created_at
		   FROM feedback WHERE id = ?`, id)
	rep, err := scanReport(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rep, err
}

func (r *SQLiteRepository) SetResolved(ctx context.Context, id string, resolved bool) error {
	var at any
	if resolved {
		at = time.Now().UTC()
	}
	res, err := r.db.ExecContext(ctx, `UPDATE feedback SET resolved_at = ? WHERE id = ?`, at, id)
	return affected(res, err, "set resolved")
}

func (r *SQLiteRepository) DeleteAllForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM feedback WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("feedback: delete all for user: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM feedback WHERE id = ?`, id)
	return affected(res, err, "delete")
}

func affected(res sql.Result, err error, what string) error {
	if err != nil {
		return fmt.Errorf("feedback: %s: %w", what, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("feedback: %s: %w", what, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface{ Scan(dest ...any) error }

func scanReport(s scanner) (*Report, error) {
	var (
		rep         Report
		category    string
		diagnostics string
		hasDiag     bool
		resolvedAt  sql.NullTime
	)
	if err := s.Scan(&rep.ID, &rep.UserID, &rep.Username, &category, &rep.Message,
		&diagnostics, &hasDiag, &resolvedAt, &rep.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		return nil, fmt.Errorf("feedback: scan: %w", err)
	}
	rep.Category = Category(category)
	rep.Diagnostics = diagnostics
	rep.HasDiagnostics = hasDiag
	if resolvedAt.Valid {
		t := resolvedAt.Time.UTC()
		rep.ResolvedAt = &t
	}
	return &rep, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
