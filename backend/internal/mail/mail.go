// Package mail sends transactional email (e.g. account-deletion codes) via SMTP.
package mail

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// Config holds SMTP connection settings. It is resolved at send time so callers
// can source it from environment variables or, later, a database.
type Config struct {
	Host       string
	Port       int
	Username   string
	Password   string
	From       string
	FromName   string
	Encryption string // "none", "starttls", or "tls" (implicit TLS / SSL)
}

// Configured reports whether the minimum settings to send mail are present.
func (c Config) Configured() bool {
	return strings.TrimSpace(c.Host) != "" && c.Port > 0 && strings.TrimSpace(c.From) != ""
}

// Sender delivers messages using a Config.
type Sender struct {
	cfg Config
}

// New returns a Sender for the given config.
func New(cfg Config) *Sender { return &Sender{cfg: cfg} }

// Configured reports whether the sender has the minimum settings to send mail.
func (s *Sender) Configured() bool { return s.cfg.Configured() }

// Send delivers a plain-text email to a single recipient.
func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	if !s.cfg.Configured() {
		return errors.New("email is not configured")
	}

	msg := gomail.NewMsg()
	fromName := s.cfg.FromName
	if fromName == "" {
		fromName = "Activity Lens"
	}
	if err := msg.FromFormat(fromName, s.cfg.From); err != nil {
		return fmt.Errorf("set from: %w", err)
	}
	if err := msg.To(to); err != nil {
		return fmt.Errorf("set to: %w", err)
	}
	msg.Subject(subject)
	msg.SetBodyString(gomail.TypeTextPlain, body)

	opts := []gomail.Option{gomail.WithPort(s.cfg.Port), gomail.WithTimeout(15 * time.Second)}

	switch strings.ToLower(strings.TrimSpace(s.cfg.Encryption)) {
	case "tls", "ssl":
		opts = append(opts, gomail.WithSSL())
	case "none", "":
		opts = append(opts, gomail.WithTLSPolicy(gomail.NoTLS))
	default: // "starttls"
		opts = append(opts, gomail.WithTLSPolicy(gomail.TLSMandatory))
	}

	if s.cfg.Username != "" {
		opts = append(opts, gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
			gomail.WithUsername(s.cfg.Username), gomail.WithPassword(s.cfg.Password))
	}

	client, err := gomail.NewClient(s.cfg.Host, opts...)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	return client.DialAndSendWithContext(ctx, msg)
}
