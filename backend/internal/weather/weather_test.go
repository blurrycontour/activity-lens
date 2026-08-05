package weather

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Weather is decoration until someone reads a number off it and changes how
// they train. Every case here is a way to store a plausible, confidently
// rendered, wrong number — which is exactly the kind of bug nobody reports
// because nothing looks broken.

// hourly builds a response body with one entry per hour from base.
func hourly(base time.Time, temps ...float64) string {
	var times, t, apparent, humidity, wind, precip, code []string
	for i, v := range temps {
		times = append(times, `"`+base.Add(time.Duration(i)*time.Hour).Format("2006-01-02T15:04")+`"`)
		t = append(t, fmt.Sprintf("%g", v))
		apparent = append(apparent, fmt.Sprintf("%g", v-2))
		humidity = append(humidity, "60")
		wind = append(wind, "10")
		precip = append(precip, "1")
		code = append(code, "1")
	}
	return `{"hourly":{"time":[` + strings.Join(times, ",") + `],
		"temperature_2m":[` + strings.Join(t, ",") + `],
		"apparent_temperature":[` + strings.Join(apparent, ",") + `],
		"relative_humidity_2m":[` + strings.Join(humidity, ",") + `],
		"wind_speed_10m":[` + strings.Join(wind, ",") + `],
		"precipitation":[` + strings.Join(precip, ",") + `],
		"weather_code":[` + strings.Join(code, ",") + `]}}`
}

// serveBody answers everything with one body, recording the last query.
func serveBody(t *testing.T, body string, status int) (*Client, *url.Values) {
	t.Helper()
	var last url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		last = r.URL.Query()
		w.WriteHeader(status)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return &Client{client: srv.Client(), archiveURL: srv.URL, forecastURL: srv.URL}, &last
}

// The whole reason for two endpoints. Getting this backwards means weather
// silently stops working for anything in the last five days — the week anyone
// would check first — while old workouts keep succeeding, so it looks fine.
func TestEndpointChoice(t *testing.T) {
	var hits []string
	archive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "archive")
		fmt.Fprint(w, hourly(time.Date(2020, 1, 1, 8, 0, 0, 0, time.UTC), 10))
	}))
	defer archive.Close()
	forecast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "forecast")
		fmt.Fprint(w, hourly(time.Now().UTC().Add(-2*time.Hour).Truncate(time.Hour), 10))
	}))
	defer forecast.Close()

	c := &Client{client: archive.Client(), archiveURL: archive.URL, forecastURL: forecast.URL}
	ctx := context.Background()

	if _, err := c.At(ctx, 51.5, -0.1, time.Now().Add(-2*time.Hour), time.Hour); err != nil {
		t.Fatalf("recent lookup: %v", err)
	}
	if _, err := c.At(ctx, 51.5, -0.1, time.Date(2020, 1, 1, 8, 0, 0, 0, time.UTC), time.Hour); err != nil {
		t.Fatalf("old lookup: %v", err)
	}
	want := []string{"forecast", "archive"}
	if len(hits) != 2 || hits[0] != want[0] || hits[1] != want[1] {
		t.Errorf("endpoints hit = %v, want %v", hits, want)
	}
}

// A workout is a span, not an instant. A four-hour hike that starts cold and
// finishes in the sun is exactly where temperature matters, and its start hour
// describes none of it.
func TestAggregatesAcrossTheWorkout(t *testing.T) {
	start := time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC)
	c, _ := serveBody(t, hourly(start, 10, 14, 18, 22), http.StatusOK)

	got, err := c.At(context.Background(), 51.5, -0.1, start, 3*time.Hour)
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	// Three hours covers the first three samples: mean of 10, 14, 18.
	if got.TempC != 14 {
		t.Errorf("TempC = %v, want the mean 14 of the hours covered", got.TempC)
	}
	// Rain is a total, not an average: 1 mm in each of three hours is 3 mm.
	if got.PrecipMm != 3 {
		t.Errorf("PrecipMm = %v, want the sum 3", got.PrecipMm)
	}
}

// A short workout must not average in hours it never touched.
func TestShortWorkoutUsesOnlyItsHour(t *testing.T) {
	start := time.Date(2023, 6, 1, 6, 10, 0, 0, time.UTC)
	c, _ := serveBody(t, hourly(start.Truncate(time.Hour), 10, 30), http.StatusOK)

	got, err := c.At(context.Background(), 51.5, -0.1, start, 30*time.Minute)
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	if got.TempC != 10 {
		t.Errorf("TempC = %v, want 10 — the 07:00 sample is outside a 06:10-06:40 workout", got.TempC)
	}
}

// The worst it got, not the average of the codes: averaging "clear" and
// "thunderstorm" would report drizzle, which happened to nobody.
func TestWeatherCodeTakesTheWorst(t *testing.T) {
	start := time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC)
	body := `{"hourly":{"time":["2023-06-01T06:00","2023-06-01T07:00"],
		"temperature_2m":[10,11],"apparent_temperature":[9,10],
		"relative_humidity_2m":[60,60],"wind_speed_10m":[10,10],
		"precipitation":[0,0],"weather_code":[1,95]}}`
	c, _ := serveBody(t, body, http.StatusOK)

	got, err := c.At(context.Background(), 51.5, -0.1, start, 2*time.Hour)
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	if got.Code != 95 {
		t.Errorf("Code = %d, want 95", got.Code)
	}
}

// A workout that runs past midnight needs two dates requested, or the hours
// after midnight are simply missing and the average is of the wrong half.
func TestCrossingMidnightRequestsBothDates(t *testing.T) {
	start := time.Date(2023, 6, 1, 23, 40, 0, 0, time.UTC)
	c, q := serveBody(t, hourly(start.Truncate(time.Hour), 10, 12), http.StatusOK)

	if _, err := c.At(context.Background(), 51.5, -0.1, start, 90*time.Minute); err != nil {
		t.Fatalf("At: %v", err)
	}
	if got := q.Get("start_date"); got != "2023-06-01" {
		t.Errorf("start_date = %q, want 2023-06-01", got)
	}
	if got := q.Get("end_date"); got != "2023-06-02" {
		t.Errorf("end_date = %q, want 2023-06-02", got)
	}
}

// Open-Meteo really does emit nulls. Decoded into a plain float64 they become
// 0 — a believable temperature and an impossible humidity — and nothing would
// ever flag it.
func TestNullSamplesAreSkippedNotReadAsZero(t *testing.T) {
	body := `{"hourly":{"time":["2023-06-01T06:00","2023-06-01T07:00"],
		"temperature_2m":[null,20],"apparent_temperature":[null,19],
		"relative_humidity_2m":[null,50],"wind_speed_10m":[null,5],
		"precipitation":[null,0],"weather_code":[null,0]}}`
	c, _ := serveBody(t, body, http.StatusOK)

	got, err := c.At(context.Background(), 51.5, -0.1,
		time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC), 2*time.Hour)
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	if got.TempC != 20 {
		t.Errorf("TempC = %v, want 20 — the null hour must not drag the mean to 10", got.TempC)
	}
	if got.Humidity != 50 {
		t.Errorf("Humidity = %v, want 50", got.Humidity)
	}
}

// The caller has to choose between "never ask again" and "try later", and it
// can only do that if this package classifies the failure.
func TestErrorClassification(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		body      string
		permanent bool
	}{
		{"a rejected request is permanent", http.StatusBadRequest,
			`{"error":true,"reason":"start_date is out of allowed range"}`, true},
		{"an error object in a 200 is permanent", http.StatusOK,
			`{"error":true,"reason":"No data available"}`, true},
		{"a window with no samples is permanent", http.StatusOK,
			`{"hourly":{"time":[],"temperature_2m":[]}}`, true},
		{"a server error is retryable", http.StatusServiceUnavailable, `nope`, false},
		{"rate limiting is retryable", http.StatusTooManyRequests, `slow down`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := serveBody(t, tt.body, tt.status)
			_, err := c.At(context.Background(), 51.5, -0.1,
				time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC), time.Hour)
			if err == nil {
				t.Fatal("expected an error")
			}
			if got := errors.Is(err, ErrPermanent); got != tt.permanent {
				t.Errorf("errors.Is(err, ErrPermanent) = %v, want %v (err: %v)", got, tt.permanent, err)
			}
		})
	}
}

// Both sides are UTC — workout start times are stored UTC and ERA5 is UTC.
// Asking for anything else introduces a conversion with nothing to gain, and
// an off-by-one-hour temperature is invisible.
func TestRequestsUTC(t *testing.T) {
	start := time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC)
	c, q := serveBody(t, hourly(start, 10), http.StatusOK)

	if _, err := c.At(context.Background(), 51.5, -0.1, start, time.Hour); err != nil {
		t.Fatalf("At: %v", err)
	}
	if got := q.Get("timezone"); got != "UTC" {
		t.Errorf("timezone = %q, want UTC", got)
	}
	if got := q.Get("wind_speed_unit"); got != "kmh" {
		t.Errorf("wind_speed_unit = %q, want kmh — the model field is named WindKph", got)
	}
}

// A zero-duration workout (manual entry, a paused import) still happened at a
// moment. Treating its window as empty would match no hours and report a
// permanent failure for something perfectly answerable.
func TestZeroDurationStillResolves(t *testing.T) {
	start := time.Date(2023, 6, 1, 6, 30, 0, 0, time.UTC)
	c, _ := serveBody(t, hourly(start.Truncate(time.Hour), 12), http.StatusOK)

	got, err := c.At(context.Background(), 51.5, -0.1, start, 0)
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	if got.TempC != 12 {
		t.Errorf("TempC = %v, want 12", got.TempC)
	}
}

// Running out of quota is not a fact about the workout.
//
// Open-Meteo reports the per-minute limit as a 429 but the *daily* allowance as
// a 400 whose only distinguishing feature is the sentence in the body. Read
// literally that is a permanent rejection — and treating it as one marks every
// workout touched during a busy day as impossible, forever, for a condition
// that clears itself at midnight.
func TestQuotaIsThrottledNotPermanent(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{
			"the daily allowance, which arrives as a 400",
			http.StatusBadRequest,
			`{"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."}`,
		},
		{
			"the minutely limit, same shape",
			http.StatusBadRequest,
			`{"error":true,"reason":"Minutely API request limit exceeded."}`,
		},
		{
			"an explicit 429",
			http.StatusTooManyRequests,
			`{"error":true,"reason":"Too many requests"}`,
		},
		{
			"a limit reported inside a 200",
			http.StatusOK,
			`{"error":true,"reason":"Hourly API request limit exceeded."}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := serveBody(t, tt.body, tt.status)
			_, err := c.At(context.Background(), 51.5, -0.1,
				time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC), time.Hour)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !errors.Is(err, ErrThrottled) {
				t.Errorf("err = %v, want ErrThrottled", err)
			}
			// The distinction that matters: throttled rows are left queued,
			// permanent ones are settled and never retried.
			if errors.Is(err, ErrPermanent) {
				t.Error("a spent quota was classified as permanent; those workouts would never be retried")
			}
		})
	}
}

// The other direction: a genuinely bad request must not be mistaken for a
// quota problem, or the row is retried forever against an error that will
// never clear.
func TestBadRequestIsStillPermanent(t *testing.T) {
	c, _ := serveBody(t, `{"error":true,"reason":"Parameter 'start_date' is out of allowed range"}`,
		http.StatusBadRequest)
	_, err := c.At(context.Background(), 51.5, -0.1,
		time.Date(2023, 6, 1, 6, 0, 0, 0, time.UTC), time.Hour)
	if !errors.Is(err, ErrPermanent) {
		t.Errorf("err = %v, want ErrPermanent", err)
	}
	if errors.Is(err, ErrThrottled) {
		t.Error("an unfixable request was classified as throttled; it would retry forever")
	}
}
