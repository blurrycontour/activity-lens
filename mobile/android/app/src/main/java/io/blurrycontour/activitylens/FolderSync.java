package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the folder watch remembers between runs.
 *
 * All of it has to survive process death, because most of it is read by a
 * WorkManager job that runs when nothing else of the app is alive.
 *
 * The watched folders are a list. One is the common case and was the only case
 * for a while, but a phone that records with more than one app has more than one
 * folder — a watch's export directory and a cycling app's, say — and the
 * alternative is asking the user to pick a common ancestor, which grants the app
 * far more of the filesystem than it needs.
 */
final class FolderSync {

    private FolderSync() {}

    private static final String TAG = "FolderSync";

    private static final String PREFS = "folder_sync";
    private static final String KEY_FOLDERS = "folders";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_INTERVAL = "interval_minutes";
    private static final String KEY_BACKSTOP_MIGRATED = "backstop_migrated";
    /** Prefix for the per-folder seen sets: `seen:` + the folder's URI. */
    private static final String SEEN_PREFIX = "seen:";

    // The single-folder layout this replaced. Read once by migrate(), never
    // written, and left in place afterwards so downgrading to the previous
    // version still finds its folder.
    private static final String OLD_KEY_TREE = "tree";
    private static final String OLD_KEY_LABEL = "label";
    private static final String OLD_KEY_SEEN = "seen";

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
     * How many folders may be watched.
     *
     * Each one is a persisted URI grant and a content trigger, and the system
     * caps both. The limit exists so hitting a system cap is not how the user
     * finds out.
     */
    static final int MAX_FOLDERS = 8;

    /**
     * How many file fingerprints to remember, per folder.
     *
     * The set only exists to avoid re-reading and re-hashing files that were
     * dealt with on an earlier scan; the server's content-hash check is what
     * actually prevents duplicate imports, so losing entries here costs a little
     * work and never correctness. Capped so a folder that grows forever cannot
     * turn this into an unbounded preference blob.
     */
    private static final int MAX_SEEN = 2000;

    /** One watched folder. */
    static final class Folder {
        final Uri uri;
        final String label;
        /** When this folder was last scanned, as epoch millis, or 0. */
        final long lastScan;
        /** A few words describing how that scan went, for the Settings screen. */
        final String lastResult;

        Folder(Uri uri, String label, long lastScan, String lastResult) {
            this.uri = uri;
            this.label = label;
            this.lastScan = lastScan;
            this.lastResult = lastResult;
        }
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The watched folders, in the order they were added. */
    static List<Folder> folders(Context context) {
        migrate(context);
        List<Folder> folders = new ArrayList<>();
        String raw = prefs(context).getString(KEY_FOLDERS, null);
        if (raw == null) {
            return folders;
        }
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject o = array.getJSONObject(i);
                String uri = o.optString("uri", null);
                if (uri == null || uri.isEmpty()) {
                    continue;
                }
                folders.add(new Folder(
                    Uri.parse(uri),
                    o.optString("label", "Folder"),
                    o.optLong("lastScan", 0),
                    o.optString("lastResult", null)));
            }
        } catch (Exception e) {
            // Unreadable state is not worth crashing a background job over. The
            // user sees no folders and can pick again, which is recoverable;
            // a stack trace on every scan is not.
            Log.w(TAG, "could not read watched folders", e);
        }
        return folders;
    }

    private static void save(Context context, List<Folder> folders) {
        JSONArray array = new JSONArray();
        for (Folder f : folders) {
            try {
                JSONObject o = new JSONObject();
                o.put("uri", f.uri.toString());
                o.put("label", f.label);
                o.put("lastScan", f.lastScan);
                if (f.lastResult != null) {
                    o.put("lastResult", f.lastResult);
                }
                array.put(o);
            } catch (Exception e) {
                Log.w(TAG, "could not store folder " + f.label, e);
            }
        }
        prefs(context).edit().putString(KEY_FOLDERS, array.toString()).apply();
    }

    /**
     * Carries a single watched folder over from the layout that preceded this.
     *
     * Runs once, keyed on the new list not existing yet. The old keys are read
     * and left alone: nothing else reads them, they are a few bytes, and leaving
     * them means a user who downgrades still has their folder.
     */
    private static void migrate(Context context) {
        SharedPreferences prefs = prefs(context);
        if (prefs.contains(KEY_FOLDERS)) {
            return;
        }
        String tree = prefs.getString(OLD_KEY_TREE, null);
        if (tree == null) {
            // Nothing to carry over. Recorded anyway so this does not re-run on
            // every read for someone who has never chosen a folder.
            prefs.edit().putString(KEY_FOLDERS, "[]").apply();
            return;
        }
        List<Folder> folders = new ArrayList<>();
        folders.add(new Folder(
            Uri.parse(tree),
            prefs.getString(OLD_KEY_LABEL, "Folder"),
            prefs.getLong("last_scan", 0),
            prefs.getString("last_result", null)));
        save(context, folders);
        // The seen set moves with it, or the first scan after upgrading would
        // re-read and re-hash the whole folder.
        Set<String> seen = prefs.getStringSet(OLD_KEY_SEEN, null);
        if (seen != null) {
            prefs.edit().putStringSet(SEEN_PREFIX + tree, new HashSet<>(seen)).apply();
        }
    }

    static boolean enabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    /**
     * Adds a folder, or renames one already watched.
     *
     * Adding the same folder twice is something the system picker makes easy to
     * do by accident, and two entries for one directory would scan it twice and
     * show it twice. Matching on the URI makes the second pick a no-op.
     */
    static boolean addFolder(Context context, Uri tree, String label) {
        List<Folder> folders = folders(context);
        for (int i = 0; i < folders.size(); i++) {
            if (folders.get(i).uri.equals(tree)) {
                folders.set(i, new Folder(tree, label, folders.get(i).lastScan, folders.get(i).lastResult));
                save(context, folders);
                return true;
            }
        }
        if (folders.size() >= MAX_FOLDERS) {
            return false;
        }
        folders.add(new Folder(tree, label, 0, null));
        save(context, folders);
        return true;
    }

    static void removeFolder(Context context, Uri tree) {
        List<Folder> folders = folders(context);
        List<Folder> kept = new ArrayList<>();
        for (Folder f : folders) {
            if (!f.uri.equals(tree)) {
                kept.add(f);
            }
        }
        save(context, kept);
        // The fingerprints go with it. Keeping them would mean a folder removed
        // and added again is not re-offered, which is the opposite of what
        // removing and re-adding is for.
        prefs(context).edit().remove(SEEN_PREFIX + tree).apply();
    }

    static void recordScan(Context context, Uri tree, String result) {
        List<Folder> folders = folders(context);
        for (int i = 0; i < folders.size(); i++) {
            if (folders.get(i).uri.equals(tree)) {
                folders.set(i, new Folder(tree, folders.get(i).label, System.currentTimeMillis(), result));
                save(context, folders);
                return;
            }
        }
    }

    /**
     * Fingerprints of files already dealt with, for one folder.
     *
     * Identity is document id + size + last modified, not content: the point is
     * to decide whether a file is worth *opening*, and reading a few hundred
     * files to answer that on every scan is the cost this avoids.
     */
    static Set<String> seen(Context context, Uri tree) {
        return new HashSet<>(prefs(context).getStringSet(SEEN_PREFIX + tree, new HashSet<>()));
    }

    static void addSeen(Context context, Uri tree, Set<String> keys) {
        Set<String> all = seen(context, tree);
        all.addAll(keys);
        if (all.size() > MAX_SEEN) {
            // Nothing here orders entries, so there is no "oldest" to drop.
            // Starting over costs one scan's worth of re-hashing, and the server
            // still refuses the duplicates, so this stays correct.
            all = new HashSet<>(keys);
        }
        prefs(context).edit().putStringSet(SEEN_PREFIX + tree, all).apply();
    }

    /** How often the backstop scan runs, in minutes. */
    static int intervalMinutes(Context context) {
        migrateBackstop(context);
        return prefs(context).getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
    }

    static void setIntervalMinutes(Context context, int minutes) {
        // WorkManager refuses anything under fifteen and silently clamps it,
        // which would leave the setting saying something untrue.
        prefs(context).edit().putInt(KEY_INTERVAL, Math.max(MIN_INTERVAL_MINUTES, minutes)).apply();
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
     * against. Null when the stored URI is not a tree — an old preference, or
     * one that has been tampered with.
     */
    static Uri childrenUri(Uri tree) {
        if (tree == null) {
            return null;
        }
        try {
            return DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        } catch (Exception e) {
            return null;
        }
    }
}
