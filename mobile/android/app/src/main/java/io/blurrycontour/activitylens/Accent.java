package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import androidx.core.content.ContextCompat;

/**
 * The accent colour the user picked, on the native side of the app.
 *
 * The web app has six accents and applies them as CSS variables, which reaches
 * everything drawn by the WebView and nothing else. Notifications are not drawn
 * by the WebView: they are built in Java from a colour compiled into the APK,
 * so someone using the rose accent had a green notification shade — the one
 * part of the app that never heard.
 *
 * Kept in a preference rather than passed in with each notification, because
 * the shade shows a notification long after the WebView was last alive: a push
 * arriving overnight is built by a receiver with no page to ask. The web app
 * writes it whenever it applies an accent, which includes every start-up, so
 * the two cannot drift for longer than one launch.
 */
final class Accent {

    private static final String PREFS = "activity-lens";
    private static final String KEY = "accent";

    private Accent() {}

    static void set(Context context, String color) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, color).apply();
    }

    /**
     * The stored accent, or the one built into the app.
     *
     * The compiled colour is the fallback for three real cases and not just for
     * tidiness: a fresh install whose WebView has not started yet, a build
     * older than this preference, and a stored value that cannot be parsed.
     */
    static int color(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stored = prefs.getString(KEY, null);
        if (stored != null) {
            try {
                return Color.parseColor(stored);
            } catch (IllegalArgumentException e) {
                // Not a colour. Fall through rather than throw from inside
                // whatever notification is being built.
            }
        }
        return ContextCompat.getColor(context, R.color.app_accent);
    }
}
