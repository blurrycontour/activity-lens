package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import java.util.Arrays;

/**
 * Home-screen (long-press) app shortcuts for logging a body vital, and the
 * launch action they carry back in.
 *
 * Dynamic rather than static (res/xml) on purpose: the launcher here is one of
 * six activity-aliases, swapped at runtime by LauncherIcon, and static
 * shortcuts attach to whichever alias holds the MAIN/LAUNCHER filter — a moving
 * target. Registering them in code against MainActivity sidesteps that and also
 * works across build variants, whose package name carries an id suffix.
 *
 * Each shortcut launches MainActivity with a private action string. The web app
 * asks for the pending action once it has booted (ShellPlugin.getLaunchAction)
 * and jumps straight to the matching quick-add sheet — see
 * frontend/src/lib/native/shell.ts and the ?logVital deep link in Analysis.
 */
final class VitalShortcuts {

    static final String ACTION_LOG_WEIGHT = "io.blurrycontour.activitylens.LOG_WEIGHT";
    static final String ACTION_LOG_BP = "io.blurrycontour.activitylens.LOG_BP";

    /** The action a shortcut launch left behind, for the page to pick up once. */
    private static String pending;

    private VitalShortcuts() {}

    /** Publishes the two shortcuts. Safe to call on every launch; it replaces. */
    static void register(Context context) {
        ShortcutInfoCompat weight = new ShortcutInfoCompat.Builder(context, "log_weight")
                .setShortLabel(context.getString(R.string.shortcut_weight_short))
                .setLongLabel(context.getString(R.string.shortcut_weight_long))
                .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_weight))
                .setIntent(launchIntent(context, ACTION_LOG_WEIGHT))
                .build();
        ShortcutInfoCompat bp = new ShortcutInfoCompat.Builder(context, "log_bp")
                .setShortLabel(context.getString(R.string.shortcut_bp_short))
                .setLongLabel(context.getString(R.string.shortcut_bp_long))
                .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_bp))
                .setIntent(launchIntent(context, ACTION_LOG_BP))
                .build();
        ShortcutManagerCompat.setDynamicShortcuts(context, Arrays.asList(weight, bp));
    }

    private static Intent launchIntent(Context context, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(action);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    /** Records the launch action when the intent came from one of our shortcuts. */
    static void stash(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (ACTION_LOG_WEIGHT.equals(action)) {
            pending = "logVital:weight";
        } else if (ACTION_LOG_BP.equals(action)) {
            pending = "logVital:bp";
        }
    }

    /** Returns the pending action once, clearing it. Null when there is none. */
    static String consume() {
        String v = pending;
        pending = null;
        return v;
    }
}
