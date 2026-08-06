package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
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
    private static final String KEY_BACKSTOP_MIGRATED = "backstop_migrated";

    /** WorkManager's own floor for a periodic job. Asking for less is ignored. */
    static final int MIN_INTERVAL_MINUTES = 15;

    /**
     * How often the periodic scan runs now that it is only a safety net.
     *
     * The watch is event-driven — see FolderSyncWorker — so the schedule exists
     * for the cases a content notification cannot cover: a file that appeared
     * while the phone was off, and a provider that does not announce its
     * changes at all. Six hours is chosen against those, not against how soon a
     * file should import, which is no longer this number's job.
     */
    static final int DEFAULT_INTERVAL_MINUTES = 360;

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
        migrateBackstop(context);
        return prefs(context).getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
    }

    /**
     * Raises the old polling interval to the new backstop default, once.
     *
     * Before the content-trigger watch this number was the only thing that
     * decided how soon a file imported, so anyone who cared set it to fifteen
     * minutes. Left alone it would keep waking the phone ninety-six times a day
     * to find nothing, for a timeliness the trigger now provides for free.
     *
     * Only ever upwards, and only once: someone who deliberately picks a short
     * backstop after the upgrade keeps it.
     */
    private static void migrateBackstop(Context context) {
        SharedPreferences prefs = prefs(context);
        if (prefs.getBoolean(KEY_BACKSTOP_MIGRATED, false)) {
            return;
        }
        int current = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
        SharedPreferences.Editor edit = prefs.edit().putBoolean(KEY_BACKSTOP_MIGRATED, true);
        if (current < DEFAULT_INTERVAL_MINUTES) {
            edit.putInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
        }
        edit.apply();
    }

    /**
     * The URI whose contents Android can watch on the app's behalf.
     *
     * A tree URI names the grant, not the listing, and nothing notifies on it.
     * The children URI is the one a DocumentsProvider calls notifyChange on when
     * a file is added or removed, so it is the one worth registering a trigger
     * against. Null when no folder is chosen, or when the stored URI is not a
     * tree — an old preference, or one that has been tampered with.
     */
    static Uri childrenUri(Context context) {
        Uri tree = tree(context);
        if (tree == null) {
            return null;
        }
        try {
            return DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        } catch (Exception e) {
            return null;
        }
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
