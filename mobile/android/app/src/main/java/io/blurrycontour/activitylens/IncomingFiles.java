package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Parcelable;
import android.provider.OpenableColumns;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Workout files arriving from outside the app — the share sheet, or "open with"
 * on a .gpx in a file manager.
 *
 * This is the native half of what `share_target` and `file_handlers` in the web
 * manifest do for the PWA. Android gives a PWA neither, so without this the app
 * a user installs from the APK is the one place a shared workout has nowhere to
 * go.
 *
 * The end of the journey is the same for both: the import modal opens with the
 * files already in it. Only the delivery differs — the service worker stashes
 * into the Cache API, and this stashes into the app's cache directory.
 *
 * <h2>Why the bytes are copied here rather than read on demand</h2>
 *
 * What arrives is a `content://` URI, and the read permission on it lives and
 * dies with the intent that carried it. By the time a WebView has booted and
 * some JavaScript asks for the file, that grant may be gone — and on a cold
 * start it usually is. So the bytes are taken while the grant is definitely
 * valid, and what is handed on is a path this app owns outright.
 *
 * Streamed to disk rather than held in memory: a Strava export is a zip that can
 * run to hundreds of megabytes, and the app unpacks those client-side.
 */
final class IncomingFiles {

    private static final String TAG = "IncomingFiles";

    private static final String PREFS = "incoming-files";
    private static final String KEY_PENDING = "pending";

    /** Where the copies live, under the app's own cache directory. */
    private static final String CACHE_SUBDIR = "incoming";

    /**
     * What the app can actually do something with, matched on the file name.
     *
     * The same list the web manifest accepts. Android share intents carry a MIME
     * type that is frequently `application/octet-stream` or nothing useful at
     * all, so the extension is the only dependable signal — which is also why
     * the manifest's intent filters can afford to be broad. Anything that gets
     * past them and is not one of these is dropped here.
     */
    private static final String[] EXTENSIONS = { ".gpx", ".tcx", ".fit", ".zip", ".gz" };

    /** Upper bound on one share, mirroring MAX_SHARED_FILES on the web side. */
    private static final int MAX_FILES = 200;

    private IncomingFiles() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Takes any workout files the intent carries and puts them somewhere the
     * page can collect them.
     *
     * Safe to call with anything — a launcher tap, a notification, a deep link.
     * An intent with no files of interest leaves the pending set untouched, so
     * this can sit unconditionally in onCreate and onNewIntent next to the other
     * stashers without having to ask what kind of intent it is first.
     *
     * @return true when at least one file was accepted, so the caller knows
     *         whether there is anything worth telling the page about.
     */
    static boolean stash(Context context, Intent intent) {
        // Everything worth keeping is worked out before anything is thrown away.
        // A share of files this app has no use for must not be what discards a
        // batch the user is still waiting on.
        List<Uri> accepted = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (Uri uri : urisFrom(intent)) {
            if (accepted.size() >= MAX_FILES) {
                break;
            }
            String name = displayName(context, uri);
            if (!isWorkoutFile(name)) {
                Log.w(TAG, "ignoring " + name + ": not a workout file");
                continue;
            }
            accepted.add(uri);
            names.add(name);
        }
        if (accepted.isEmpty()) {
            return false;
        }

        // A fresh share supersedes one nobody claimed: "the files the user just
        // sent" is the only set that can be acted on, and the web side reads the
        // most recent share the same way. Clearing here also means the cache
        // directory holds one batch rather than growing forever.
        clear(context);

        File dir = cacheDir(context);
        if (dir == null) {
            return false;
        }

        JSONArray pending = new JSONArray();
        for (int i = 0; i < accepted.size(); i++) {
            Uri uri = accepted.get(i);
            String name = names.get(i);
            // Prefixed with the index so two files shared under the same name
            // cannot overwrite each other, and so the stored name can never
            // steer the write out of this directory.
            File dest = new File(dir, pending.length() + "-" + safeName(name));
            long size = copy(context, uri, dest);
            if (size < 0) {
                continue;
            }
            try {
                JSONObject entry = new JSONObject();
                entry.put("name", name);
                entry.put("path", dest.getAbsolutePath());
                entry.put("size", size);
                String type = context.getContentResolver().getType(uri);
                entry.put("mimeType", type == null ? "" : type);
                pending.put(entry);
            } catch (Exception e) {
                Log.w(TAG, "could not record " + name + ": " + e.getMessage());
            }
        }

        if (pending.length() == 0) {
            return false;
        }
        prefs(context).edit().putString(KEY_PENDING, pending.toString()).apply();

        // Consumed off the intent, so a task resumed from Recents — which hands
        // back the intent that started it — cannot import the same share twice.
        consumeIntent(intent);
        return true;
    }

    /**
     * Hands over the pending files, once, and forgets them.
     *
     * The copies themselves are left on disk: the page has only been given paths
     * at this point and still has to read them. They go on the next stash, and
     * the cache directory is one Android will reclaim on its own if it never
     * does.
     */
    static JSONArray take(Context context) {
        SharedPreferences store = prefs(context);
        String raw = store.getString(KEY_PENDING, null);
        if (raw == null) {
            return new JSONArray();
        }
        store.edit().remove(KEY_PENDING).apply();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Every URI an intent carries, whatever shape it arrived in. */
    private static List<Uri> urisFrom(Intent intent) {
        List<Uri> out = new ArrayList<>();
        if (intent == null || intent.getAction() == null) {
            return out;
        }
        switch (intent.getAction()) {
            case Intent.ACTION_VIEW:
                // "Open with" from a file manager.
                add(out, intent.getData());
                break;
            // Both read as Parcelable rather than Uri, and are filtered by
            // add(). The extra is whatever the sending app chose to put there;
            // typing it as Uri would only move a wrong type to the first use of
            // it, as a ClassCastException somewhere less obvious than here.
            case Intent.ACTION_SEND:
                Parcelable one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                add(out, one);
                break;
            case Intent.ACTION_SEND_MULTIPLE:
                ArrayList<Parcelable> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (many != null) {
                    for (Parcelable each : many) {
                        add(out, each);
                    }
                }
                break;
            default:
                break;
        }
        return out;
    }

    private static void add(List<Uri> out, Object uri) {
        if (uri instanceof Uri) {
            out.add((Uri) uri);
        }
    }

    /**
     * Clears the pending set and deletes the copies behind it.
     *
     * Also the recovery path for a batch that was handed over and then lost —
     * the app was killed mid-import, say. Nothing refers to those files any
     * more, and the next share removes them.
     */
    private static void clear(Context context) {
        prefs(context).edit().remove(KEY_PENDING).apply();
        File dir = cacheDir(context);
        File[] stale = dir == null ? null : dir.listFiles();
        if (stale == null) {
            return;
        }
        for (File file : stale) {
            if (!file.delete()) {
                Log.w(TAG, "could not delete " + file.getName());
            }
        }
    }

    private static File cacheDir(Context context) {
        File dir = new File(context.getCacheDir(), CACHE_SUBDIR);
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "could not create " + dir);
            return null;
        }
        return dir;
    }

    /** Copies a content URI to a file we own. Returns its size, or -1. */
    private static long copy(Context context, Uri uri, File dest) {
        try (InputStream in = context.getContentResolver().openInputStream(uri)) {
            if (in == null) {
                return -1;
            }
            long total = 0;
            try (OutputStream out = new FileOutputStream(dest)) {
                byte[] chunk = new byte[16384];
                int read;
                while ((read = in.read(chunk)) != -1) {
                    out.write(chunk, 0, read);
                    total += read;
                }
            }
            return total;
        } catch (Exception e) {
            Log.w(TAG, "could not copy " + uri + ": " + e.getMessage());
            // A partial file is worse than none: it would import as a truncated
            // workout rather than failing.
            if (dest.exists() && !dest.delete()) {
                Log.w(TAG, "could not clean up " + dest.getName());
            }
            return -1;
        }
    }

    /**
     * The file's name as the user knows it.
     *
     * A `content://` URI's path is the provider's business and frequently a row
     * id, so the name has to be asked for. The last path segment is the fallback
     * for `file://` and for providers that do not answer.
     */
    static String displayName(Context context, Uri uri) {
        if (uri == null) {
            return "";
        }
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = context.getContentResolver()
                    .query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    String name = column >= 0 ? cursor.getString(column) : null;
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "could not read a name for " + uri + ": " + e.getMessage());
            }
        }
        String segment = uri.getLastPathSegment();
        return segment == null ? "" : segment;
    }

    /** Whether the app has any use for a file of this name. */
    static boolean isWorkoutFile(String name) {
        if (name == null) {
            return false;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        for (String ext : EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Reduces a name from elsewhere to something safe to write.
     *
     * The name comes from another app, and it is only ever used to build a path
     * inside the cache directory — so anything that could climb out of it, or
     * mean something to a filesystem, is replaced rather than trusted.
     */
    static String safeName(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        // Leading dots would make the copy a hidden file, and ".." a traversal.
        while (cleaned.startsWith(".")) {
            cleaned = cleaned.substring(1);
        }
        if (cleaned.isEmpty()) {
            return "workout";
        }
        // Long names are a filesystem limit rather than a security one, but the
        // extension is the part that matters and truncating the front keeps it.
        return cleaned.length() <= 96 ? cleaned : cleaned.substring(cleaned.length() - 96);
    }

    /**
     * Strips the payload off an intent once it has been taken.
     *
     * Both the data URI and the stream extra, because the activity is
     * singleTask: Android hands back the launching intent when the task is
     * resumed from Recents, and an intent that still carries a file would be
     * read as a fresh share every time the user switched back to the app.
     */
    private static void consumeIntent(Intent intent) {
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
    }
}
