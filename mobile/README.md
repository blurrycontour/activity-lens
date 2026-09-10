# mobile/

The Capacitor Android shell. A container around the same production build the
PWA ships — one app, one codebase, one set of bugs.

Building an APK, signing it, distribution, and everything the native app does
differently is documented in
**[docs/dev/android.md](../docs/dev/android.md)**
([on the docs site](https://blurrycontour.github.io/activity-lens/dev/android/)).

```sh
scripts/build-apk.sh          # debug APK, in Docker, nothing else installed
scripts/build-apk.sh release  # release build
```

## Home-screen shortcuts

Long-pressing the app icon offers **Log weight** and **Blood pressure**, which
jump straight to the body-vitals quick-add. They are *dynamic* shortcuts
registered in code (`VitalShortcuts.java`), not static `res/xml` ones, because
the launcher here is one of six activity-aliases swapped at runtime — static
shortcuts would attach to a moving target. Each launches `MainActivity` with a
private action that `ShellPlugin.getLaunchAction` hands to the web app, which
opens `/analysis?logVital=weight|bp` (see `frontend/src/lib/native/shell.ts`).

