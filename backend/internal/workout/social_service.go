package workout

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Business rules for comments and reactions. Validation lives here rather than
// in the handler so every future caller — a mobile client, a script, a second
// endpoint — gets the same limits without restating them.

// Comments returns a workout's comments, oldest first.
func (s *Service) Comments(ctx context.Context, workoutID string) ([]Comment, error) {
	return s.repo.ListComments(ctx, workoutID)
}

// AddComment stores a message from authorID on a workout they can see.
func (s *Service) AddComment(ctx context.Context, workoutID string, authorID int64, body string) (Comment, error) {
	body, err := cleanCommentBody(body)
	if err != nil {
		return Comment{}, err
	}
	id, err := newCommentID()
	if err != nil {
		return Comment{}, err
	}
	c := Comment{
		ID:        id,
		WorkoutID: workoutID,
		UserID:    authorID,
		Body:      body,
		CreatedAt: time.Now().UTC(),
	}
	c.UpdatedAt = c.CreatedAt
	if err := s.repo.AddComment(ctx, c); err != nil {
		return Comment{}, err
	}
	return c, nil
}

// EditComment rewrites a comment the caller wrote.
func (s *Service) EditComment(ctx context.Context, workoutID, commentID string, authorID int64, body string) (Comment, error) {
	body, err := cleanCommentBody(body)
	if err != nil {
		return Comment{}, err
	}
	return s.repo.UpdateComment(ctx, workoutID, commentID, authorID, body)
}

// RemoveComment deletes a comment. Its author may always remove it; the
// workout's owner may remove any of them, which is the only moderation control
// on a page they published.
func (s *Service) RemoveComment(ctx context.Context, workoutID, commentID string, requesterID int64, isWorkoutOwner bool) error {
	return s.repo.DeleteComment(ctx, workoutID, commentID, requesterID, isWorkoutOwner)
}

// PurgeUserComments removes every comment a deleted account wrote.
func (s *Service) PurgeUserComments(ctx context.Context, userID int64) error {
	return s.repo.DeleteCommentsForUser(ctx, userID)
}

// Reactions returns a workout's reactions, oldest first.
func (s *Service) Reactions(ctx context.Context, workoutID string) ([]Reaction, error) {
	return s.repo.ListReactions(ctx, workoutID)
}

// SetReaction records one person's reaction, replacing whatever they had.
func (s *Service) SetReaction(ctx context.Context, workoutID string, userID int64, emoji string) error {
	if !ValidReaction(emoji) {
		return fmt.Errorf("%w: unknown reaction", ErrInvalid)
	}
	return s.repo.SetReaction(ctx, workoutID, userID, emoji)
}

// ClearReaction removes one person's reaction.
func (s *Service) ClearReaction(ctx context.Context, workoutID string, userID int64) error {
	return s.repo.ClearReaction(ctx, workoutID, userID)
}

// PurgeUserReactions removes every reaction a deleted account left.
func (s *Service) PurgeUserReactions(ctx context.Context, userID int64) error {
	return s.repo.DeleteReactionsForUser(ctx, userID)
}

// IsShared reports whether a workout the caller owns is visible to anyone else.
func (s *Service) IsShared(ctx context.Context, ownerID int64, workoutID string) (bool, error) {
	return s.repo.IsShared(ctx, ownerID, workoutID)
}

// cleanCommentBody trims and bounds a message.
//
// Trailing whitespace goes because a comment ending in three blank lines is a
// hole in the thread, and the length is counted in runes so the limit is the
// same amount of writing whatever the language.
func cleanCommentBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", fmt.Errorf("%w: a comment cannot be empty", ErrInvalid)
	}
	if utf8.RuneCountInString(body) > MaxCommentLength {
		return "", fmt.Errorf("%w: a comment is limited to %d characters", ErrInvalid, MaxCommentLength)
	}
	return body, nil
}
