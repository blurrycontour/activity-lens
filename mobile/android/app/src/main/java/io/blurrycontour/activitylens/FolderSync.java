package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.util.HashSet;
import java.util.Set;

/**
 * What the folder watch remembers between runs.
 *
 * All of it has to survive process death, because most of it is read by a
 * WorkManager job that runs when nothing else of the app is alive.
 */
final class FolderSync {

    private FolderSync() {}

    private static final String PREFS = "folder_sync";
    private static final String KEY_TREE = "tree";
    private static final String KEY_LABEL = "label";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_SEEN = "seen";
    private static final String KEY_LAST_SCAN = "last_scan";
    private static final String KEY_LAST_RESULT = "last_result";
    private static final String KEY_INTERVAL = "interval_minutes";

    /** WorkManager's own floor for a periodic job. Asking for less is ignored. */
    static final int MIN_INTERVAL_MINUTES = 15;
    static final int DEFAULT_INTERVAL_MINUTES = 15;

    /**
     * How many file fingerprints to remember.
     *
     * The set only exists to avoid re-reading and re-hashing files that were
     * dealt with on an earlier scan; the server's content-hash check is what
     * actually prevents duplicate imports, so losing entries here costs a little
     * work and never correctness. Capped so a folder that grows forever cannot
     * turn this into an unbounded preference blob.
     */
    private static final int MAX_SEEN = 2000;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static Uri tree(Context context) {
        String value = prefs(context).getString(KEY_TREE, null);
        return value == null ? null : Uri.parse(value);
    }

    static String label(Context context) {
        return prefs(context).getString(KEY_LABEL, null);
    }

    static boolean enabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static void setFolder(Context context, Uri tree, String label) {
        prefs(context)
            .edit()
            .putString(KEY_TREE, tree.toString())
            .putString(KEY_LABEL, label)
            // A new folder is a new set of files; carrying the old fingerprints
            // over would be harmless but pointless.
            .remove(KEY_SEEN)
            .apply();
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    /** When the last scan finished, as epoch millis, or 0. */
    static long lastScan(Context context) {
        return prefs(context).getLong(KEY_LAST_SCAN, 0);
    }

    /** A sentence describing how the last scan went, for the Settings screen. */
    static String lastResult(Context context) {
        return prefs(context).getString(KEY_LAST_RESULT, null);
    }

    static void recordScan(Context context, String result) {
        prefs(context).edit().putLong(KEY_LAST_SCAN, System.currentTimeMillis()).putString(KEY_LAST_RESULT, result).apply();
    }

    /**
     * Fingerprints of files already dealt with.
     *
     * Identity is document id + size + last modified, not content: the point is
     * to decide whether a file is worth *opening*, and reading a few hundred
     * files to answer that on every scan is the cost this avoids.
     */
    static Set<String> seen(Context context) {
        return new HashSet<>(prefs(context).getStringSet(KEY_SEEN, new HashSet<>()));
    }

    /** How often the periodic scan runs, in minutes. */
    static int intervalMinutes(Context context) {
        return prefs(context).getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
    }

    static void setIntervalMinutes(Context context, int minutes) {
        // WorkManager refuses anything under fifteen and silently clamps it,
        // which would leave the setting saying something untrue.
        prefs(context).edit().putInt(KEY_INTERVAL, Math.max(MIN_INTERVAL_MINUTES, minutes)).apply();
    }

    static void addSeen(Context context, Set<String> keys) {
        Set<String> all = seen(context);
        all.addAll(keys);
        if (all.size() > MAX_SEEN) {
            // Nothing here orders entries, so there is no "oldest" to drop.
            // Starting over costs one scan's worth of re-hashing, and the server
            // still refuses the duplicates, so this stays correct.
            all = new HashSet<>(keys);
        }
        prefs(context).edit().putStringSet(KEY_SEEN, all).apply();
    }
}
