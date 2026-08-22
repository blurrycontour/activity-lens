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
