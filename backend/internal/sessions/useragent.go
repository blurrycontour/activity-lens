// Package sessions describes a signed-in device: what kind of client it is,
// what it is running, and when it was last used.
//
// go-authkit owns the sessions table and records a user agent, an IP and a
// login time. That is enough to prove a session exists and not enough to decide
// whether to revoke it — "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
// (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" is not an answer to "is
// this still me". This package turns that string into something a person can
// read, and holds the two facts a user agent cannot carry: whether the client
// is the native app, and what version it is running.
package sessions

import "strings"

// Agent is what a user-agent string says about a client, as far as it can be
// trusted. Every field may be empty; a browser is free to send anything, and
// several deliberately lie.
type Agent struct {
	// Browser is a name and major version, e.g. "Chrome 141".
	Browser string
	// Platform is the operating system, e.g. "Windows", "Android", "macOS".
	Platform string
	// Mobile is whether the agent claims to be a phone or tablet.
	Mobile bool
	// WebView is whether this looks like an app-embedded browser rather than a
	// browser proper. Suggestive, never conclusive — see ParseAgent.
	WebView bool
}

// browsers are matched in order, because the strings are deliberately nested:
// every Chromium browser claims to be Chrome, Chrome claims to be Safari, and
// Safari claims to be Mozilla. The specific name has to win, so Edge is tested
// before Chrome and Chrome before Safari.
var browsers = []struct{ token, name string }{
	{"Edg/", "Edge"},
	{"OPR/", "Opera"},
	{"SamsungBrowser/", "Samsung Internet"},
	{"Vivaldi/", "Vivaldi"},
	{"Brave/", "Brave"},
	{"Firefox/", "Firefox"},
	{"CriOS/", "Chrome"},
	{"FxiOS/", "Firefox"},
	{"Chrome/", "Chrome"},
	{"Safari/", "Safari"},
}

// ParseAgent reads what it can out of a user-agent string.
//
// Not a general-purpose parser and not trying to be: this exists to label a row
// in a list of your own devices, where being approximately right is useful and
// being wrong is harmless. Anything it cannot place comes back empty rather
// than guessed, so the caller can fall back to showing the raw string — which
// is more honest than a confident "Unknown browser on Unknown".
func ParseAgent(ua string) Agent {
	var a Agent
	if strings.TrimSpace(ua) == "" {
		return a
	}

	a.Platform = platformOf(ua)
	a.Mobile = strings.Contains(ua, "Mobile") || strings.Contains(ua, "Android") ||
		strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad")
	// "; wv" is Android's marker for a WebView; the iOS equivalent is a UA that
	// claims mobile Safari while carrying no "Safari/" token at all.
	a.WebView = strings.Contains(ua, "; wv") || strings.Contains(ua, " wv)")

	for _, b := range browsers {
		i := strings.Index(ua, b.token)
		if i < 0 {
			continue
		}
		a.Browser = b.name
		// Safari is the exception: the number after "Safari/" is the WebKit
		// build — 605.1.15 on every Safari for years — and the browser's own
		// version is in a separate "Version/" token. Reading the first would
		// label every Mac in the list "Safari 605".
		rest := ua[i+len(b.token):]
		if b.name == "Safari" {
			j := strings.Index(ua, "Version/")
			if j < 0 {
				break
			}
			rest = ua[j+len("Version/"):]
		}
		if v := majorVersion(rest); v != "" {
			a.Browser += " " + v
		}
		break
	}
	return a
}

// platformOf names the operating system. Order matters here too: an Android
// agent also says "Linux", and iPadOS says "Mac OS X".
func platformOf(ua string) string {
	switch {
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "iPhone"):
		return "iPhone"
	case strings.Contains(ua, "iPad"):
		return "iPad"
	case strings.Contains(ua, "Windows NT"):
		return "Windows"
	case strings.Contains(ua, "Mac OS X"), strings.Contains(ua, "Macintosh"):
		return "macOS"
	case strings.Contains(ua, "CrOS"):
		return "ChromeOS"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	}
	return ""
}

// majorVersion takes the leading digits of a version string: "141.0.7390.54"
// becomes "141". The rest is noise on a device list, and on Chromium it is
// pinned to zero anyway.
func majorVersion(s string) string {
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 || end > 4 {
		return ""
	}
	return s[:end]
}
