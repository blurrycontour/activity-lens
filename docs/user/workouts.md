# Workouts

## Getting them in

**Add workout** (or `Cmd`/`Ctrl` + `I`) takes `.fit`, `.gpx` and `.tcx` files —
one, hundreds, or a whole Strava or Garmin export `.zip` dropped in exactly as
it came. Archives are unpacked in your browser, so a 2 GB export never has to be
uploaded whole.

Prefer `.fit` where you have the choice. It is what the watch actually recorded
and carries what the other two formats drop — power and temperature among them,
which show up as extra charts.

Before a batch commits you see what will happen: how many are new, how many you
already have, and which could not be read. A corrupt file never costs you the
rest of the import.

Re-importing the same file does nothing. Imports are content-addressed, so a
tracker app that shares the same activity twice updates nothing instead of
creating a duplicate.

No file? **Manual entry** takes the numbers by hand.

## Reading one

A workout opens with its route on the map — with playback, and track shading by
pace, heart rate, elevation or cadence — plus heart-rate, pace, elevation and
cadence charts, splits, and heart-rate zones.

Two small icons explain where a number came from: **Σ** means it was derived
from the recording, a **pencil** means you typed it. Recalculating a workout
replaces manual values with derived ones.

Calories and steps are taken from the file when it states them and estimated
otherwise, by whichever method you chose in Settings.

Every chart has an **info** icon with a longer explanation of what it measures
and how to read it, caveats included.

## Notes, gear and originals

- **Notes** on a workout are private. Nobody else sees them, including people
  you have shared the workout with.
- **Equipment** links a workout to a pair of shoes or a bike, which is what
  drives mileage and wear on the Equipment page. Also private.
- **Download original** gives you back the exact file the workout was imported
  from, byte for byte — when the server is set to keep originals.

## Finding things

The list and card views share one filter bar: search, sport type, date range,
distance and duration bands, and sorting. On a phone the filters are behind one
button and appear as a sheet; the chips under it show what is currently
narrowing the list, and each can be dismissed.

Hold a row to start selecting, then delete several at once.
