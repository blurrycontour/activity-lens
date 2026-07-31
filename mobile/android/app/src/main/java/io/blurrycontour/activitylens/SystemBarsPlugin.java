package io.blurrycontour.activitylens;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the system bars in step with the app's theme, and tells the page how
 * much room they take.
 *
 * The app draws edge to edge: the WebView fills the whole screen including the
 * space behind the status and navigation bars, the bars themselves are
 * transparent, and the page's own background is what shows behind the clock and
 * the gesture handle. That is not a style choice — from Android 15 an app
 * targeting API 35+ is edge-to-edge whether it asks or not, and
 * Window.setStatusBarColor is ignored, so painting the bars natively no longer
 * works at all.
 *
 * Drawing under the bars means the page has to keep its own chrome clear of
 * them, and CSS alone cannot do it here. env(safe-area-inset-*) in an Android
 * WebView reports the *display cutout* — the camera notch — and nothing else. On
 * a phone without a cutout it is zero in every direction, which is exactly how
 * the top bar ended up under the status bar and the bottom bar under the gesture
 * handle. The real bar heights are only knowable natively, so they are measured
 * here and handed to the page as CSS variables.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /** Emitted whenever the insets change: rotation, gesture-mode, foldables. */
    private static final String INSETS_EVENT = "insets";

    /** The last measurement, so a JS listener attaching late is not left blank. */
    private JSObject lastInsets = new JSObject();

    @Override
    public void load() {
        getActivity()
            .runOnUiThread(() -> {
                Window window = getActivity().getWindow();

                // Draw behind the bars. A no-op on API 35+, where it is already
                // the only behaviour, and the whole point on everything older.
                WindowCompat.setDecorFitsSystemWindows(window, false);

                // Transparent bars, so the page shows through. Deprecated and
                // ignored on API 35+; still required below it, which is why the
                // calls stay.
                if (Build.VERSION.SDK_INT < 35) {
                    window.setStatusBarColor(Color.TRANSPARENT);
                    window.setNavigationBarColor(Color.TRANSPARENT);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android would otherwise paint its own translucent scrim
                    // behind the bars to guarantee contrast, which shows up as
                    // exactly the grey band this is all meant to remove.
                    window.setStatusBarContrastEnforced(false);
                    window.setNavigationBarContrastEnforced(false);
                }

                View decor = window.getDecorView();
                ViewCompat.setOnApplyWindowInsetsListener(
                    decor,
                    (v, windowInsets) -> {
                        publishInsets(windowInsets);
                        // Passed on rather than consumed: consuming here would
                        // stop anything else in the hierarchy from ever seeing
                        // them.
                        return windowInsets;
                    }
                );
                ViewCompat.requestApplyInsets(decor);
            });
    }

    /** Converts the system bar insets to CSS pixels and sends them to the page. */
    private void publishInsets(WindowInsetsCompat windowInsets) {
        // systemBars() covers the status bar, the navigation bar and the gesture
        // handle. displayCutout() is deliberately included too: on a phone with
        // a notch in landscape, the cutout intrudes further than the bars do.
        Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());

        // The soft keyboard, which drawing edge to edge makes our problem.
        //
        // An app that lets the system fit its content gets the window resized
        // when the keyboard opens, and every text field stays visible for free.
        // Once decorFitsSystemWindows is false — which API 35+ forces anyway —
        // nothing resizes, and the keyboard simply covers the bottom of the page:
        // type in a field near the foot of a form and you cannot see what you are
        // typing. Shrinking the WebView by the keyboard's height restores the
        // behaviour the platform used to provide.
        int keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        View webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setPadding(0, 0, 0, keyboard);
        }

        // CSS pixels, not device pixels: the page reasons in the former and the
        // ratio between them is exactly the display density.
        float density = getContext().getResources().getDisplayMetrics().density;
        JSObject insets = new JSObject();
        insets.put("top", bars.top / density);
        // While the keyboard is up it has already taken the navigation bar's
        // space, and the WebView has been shrunk past both. Reporting the bar
        // inset as well would pad the page a second time for room that is no
        // longer there, leaving a gap above the keyboard.
        insets.put("bottom", keyboard > 0 ? 0 : bars.bottom / density);
        insets.put("left", bars.left / density);
        insets.put("right", bars.right / density);

        lastInsets = insets;
        notifyListeners(INSETS_EVENT, insets);
    }

    /**
     * The current insets.
     *
     * Polled once at startup because the listener above may well have fired
     * before any JavaScript was running, and a page that never hears the first
     * measurement lays itself out under the status bar.
     */
    @PluginMethod
    public void getInsets(PluginCall call) {
        call.resolve(lastInsets);
    }

    /**
     * Tells the window which way the app's theme has gone.
     *
     * @param call background - "#rrggbb", the page background behind the bars;
     *             dark - true when that colour is dark, so bar icons go light.
     */
    @PluginMethod
    public void setColors(PluginCall call) {
        String background = call.getString("background");
        // Defaults to a dark scheme: the app opens dark, and guessing wrong here
        // means invisible icons rather than a slightly-off shade.
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));

        final int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException | NullPointerException e) {
            call.reject("background must be a colour like #0a0b0e");
            return;
        }

        // Window changes must happen on the UI thread; plugin calls do not.
        getActivity()
            .runOnUiThread(() -> {
                Window window = getActivity().getWindow();

                // What is visible while the WebView has not painted — during a
                // reload, or behind a transparent page. Following the theme is
                // what stops a light-theme reload flashing black.
                window.setBackgroundDrawable(new ColorDrawable(color));

                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                // "Light bars" means dark icons for a light background, so this
                // is the inverse of whether the background itself is dark.
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);

                call.resolve();
            });
    }
}
