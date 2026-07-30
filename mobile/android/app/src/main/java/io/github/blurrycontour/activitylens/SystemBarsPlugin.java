package io.github.blurrycontour.activitylens;

import android.graphics.Color;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the status and navigation bars to match the app's current theme.
 *
 * The web app already keeps the PWA's theme-color meta tag in step with its
 * light/dark toggle, which is what makes the installed PWA's system bars match.
 * A WebView has no such mechanism — the bars belong to the Activity's window —
 * so this is the native equivalent of that same one line, and exists so the two
 * builds look identical.
 *
 * Written here rather than pulled in as a dependency. It is one API call plus
 * the icon-contrast flag, and the alternative would be another package to keep
 * version-locked across two package.json files for no benefit.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /**
     * Sets both system bars to one colour and picks the icon contrast to match.
     *
     * @param call background - "#rrggbb"; dark - true when that colour is dark,
     *             so the bar icons should be light.
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
                window.setStatusBarColor(color);
                window.setNavigationBarColor(color);

                View decor = window.getDecorView();
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
                // "Light bars" means dark icons on a light background, so this is
                // the inverse of whether the background itself is dark.
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);

                call.resolve();
            });
    }
}
