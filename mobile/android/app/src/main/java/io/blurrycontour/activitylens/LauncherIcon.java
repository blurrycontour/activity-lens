package io.blurrycontour.activitylens;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Which of the six launcher-icon aliases is enabled, kept in step with the
 * accent the web app applies.
 *
 * The six {@code activity-alias} entries in AndroidManifest.xml all point at
 * MainActivity and differ only in {@code android:icon} — Android shows the
 * launcher icon of whichever one is enabled, and refuses to show more than one
 * at a time. This class is the thing that enables one and disables the rest,
 * the same technique Google Calendar uses to put the day-of-month on its icon.
 *
 * Mirrors ACCENTS in frontend/src/lib/theme.ts by hand: a colour this map does
 * not recognise (an app build older than an accent, or one newer than this
 * file) falls back to the shipped default rather than leaving every alias
 * disabled, which would take the app out of the launcher entirely.
 */
final class LauncherIcon {

    private static final String PREFS = "activity-lens";
    private static final String KEY = "launcherIcon";

    /**
     * The alias classes' package, hardcoded rather than read from
     * {@code Context.getPackageName()}.
     *
     * A local build's applicationId carries a ".dev" suffix so it installs
     * beside the published app, but the manifest's relative alias names
     * (".LauncherGreen") resolve against the module's fixed namespace, not
     * against that suffixed id — exactly like ".MainActivity" always resolves
     * to this same package regardless of which applicationId it is installed
     * under. Building the ComponentName from getPackageName() would look for
     * "io.blurrycontour.activitylens.dev.LauncherGreen", which does not exist.
     */
    private static final String PACKAGE = "io.blurrycontour.activitylens.";

    private static final String DEFAULT_ALIAS = "LauncherGreen";

    private static final Map<String, String> ALIAS_BY_COLOR = new LinkedHashMap<>();
    static {
        ALIAS_BY_COLOR.put("#00e87a", "LauncherGreen");
        ALIAS_BY_COLOR.put("#3b82f6", "LauncherBlue");
        ALIAS_BY_COLOR.put("#ff6b35", "LauncherOrange");
        ALIAS_BY_COLOR.put("#a855f7", "LauncherViolet");
        ALIAS_BY_COLOR.put("#06b6d4", "LauncherCyan");
        ALIAS_BY_COLOR.put("#fb7185", "LauncherRose");
    }

    private LauncherIcon() {}

    /** Enables the alias for {@code color} and disables the other five. */
    static void apply(Context context, String color) {
        String target = ALIAS_BY_COLOR.getOrDefault(color.toLowerCase(), DEFAULT_ALIAS);

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // Component changes reach the launcher whether or not the state
        // actually flips, and are not free — skipped once the right alias is
        // already the one enabled, which is every app start after the first.
        if (target.equals(prefs.getString(KEY, DEFAULT_ALIAS))) return;

        PackageManager pm = context.getPackageManager();
        for (String alias : ALIAS_BY_COLOR.values()) {
            int state = alias.equals(target)
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            // DONT_KILL_APP: this runs from inside a live session, and the
            // point is a new icon next time the launcher is looked at, not a
            // restart of the page that just asked for one.
            pm.setComponentEnabledSetting(
                new ComponentName(context, PACKAGE + alias), state, PackageManager.DONT_KILL_APP);
        }
        prefs.edit().putString(KEY, target).apply();
    }
}
