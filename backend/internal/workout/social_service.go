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

// Comments returns a subject's comments, oldest first.
func (s *Service) Comments(ctx context.Context, subj Subject) ([]Comment, error) {
	return s.repo.ListComments(ctx, subj)
}

// Comment reads one message. The delete path uses it to learn whose the
// message was before it goes, since after the DELETE there is nobody to name.
func (s *Service) Comment(ctx context.Context, subj Subject, commentID string) (Comment, error) {
	return s.repo.GetComment(ctx, subj, commentID)
}

// AddComment stores a message from authorID on something they can see.
func (s *Service) AddComment(ctx context.Context, subj Subject, authorID int64, body string) (Comment, error) {
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
		UserID:    authorID,
		Body:      body,
		CreatedAt: time.Now().UTC(),
	}
	c.UpdatedAt = c.CreatedAt
	if err := s.repo.AddComment(ctx, subj, c); err != nil {
		return Comment{}, err
	}
	return c, nil
}

// EditComment rewrites a comment the caller wrote.
func (s *Service) EditComment(ctx context.Context, subj Subject, commentID string, authorID int64, body string) (Comment, error) {
	body, err := cleanCommentBody(body)
	if err != nil {
		return Comment{}, err
	}
	return s.repo.UpdateComment(ctx, subj, commentID, authorID, body)
}

// RemoveComment deletes a comment. Its author may always remove it; the
// subject's owner may remove any of them, which is the only moderation control
// on a page they published.
func (s *Service) RemoveComment(ctx context.Context, subj Subject, commentID string, requesterID int64, isOwner bool) error {
	return s.repo.DeleteComment(ctx, subj, commentID, requesterID, isOwner)
}

// PurgeUserComments removes every comment a deleted account wrote.
func (s *Service) PurgeUserComments(ctx context.Context, userID int64) error {
	return s.repo.DeleteCommentsForUser(ctx, userID)
}

// Reactions returns a subject's reactions, oldest first.
func (s *Service) Reactions(ctx context.Context, subj Subject) ([]Reaction, error) {
	return s.repo.ListReactions(ctx, subj)
}

// SetReaction records one person's reaction, replacing whatever they had.
func (s *Service) SetReaction(ctx context.Context, subj Subject, userID int64, emoji string) error {
	if !ValidReaction(emoji) {
		return fmt.Errorf("%w: unknown reaction", ErrInvalid)
	}
	return s.repo.SetReaction(ctx, subj, userID, emoji)
}

// ClearReaction removes one person's reaction.
func (s *Service) ClearReaction(ctx context.Context, subj Subject, userID int64) error {
	return s.repo.ClearReaction(ctx, subj, userID)
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
