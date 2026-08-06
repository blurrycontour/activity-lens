package io.blurrycontour.activitylens;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import androidx.documentfile.provider.DocumentFile;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Imports new workout files from the watched folders.
 *
 * This is the whole of auto-import. It runs with nothing else of the app alive —
 * from a WorkManager job — so it cannot lean on the WebView, the
 * import pipeline in importQueue.ts, or a signed-in page. What it can lean on is
 * the API, which is the same one the web app uses, and the session token the app
 * already stored.
 *
 * The order of operations is what keeps it cheap. A folder is scanned again and
 * again, mostly finding what it found last time, so:
 *
 *   1. files fingerprinted by name/size/date are skipped without being opened
 *   2. what remains is hashed and offered to /import/known in one request
 *   3. only genuinely new files are uploaded
 *
 * Without step 2 every scan would re-upload the entire folder; the server would
 * deduplicate them by content hash and nothing would break, but it would move
 * the whole library over the network every fifteen minutes.
 */
final class FolderScanner {

    private FolderScanner() {}

    private static final String TAG = "FolderSync";

    /**
     * What the backend can actually parse. `.fit` is deliberately absent — the
     * server has no parser for it, so importing one would fail per file, every
     * scan, forever. Counted as skipped instead.
     */
    private static final String[] EXTENSIONS = { ".gpx", ".tcx", ".gpx.gz", ".tcx.gz" };

    /** Refuses to read anything absurd into memory in a background job. */
    private static final int MAX_FILE_BYTES = 25 * 1024 * 1024;

    /** One scan's worth of uploads, so a first run on a huge folder still ends. */
    private static final int MAX_UPLOADS_PER_SCAN = 50;

    private static final int TIMEOUT_MS = 30_000;

    /** What happened, for the Settings screen and the job's return value. */
    static final class Result {
        final boolean ok;
        final int imported;
        final int skipped;
        final String message;

        Result(boolean ok, int imported, int skipped, String message) {
            this.ok = ok;
            this.imported = imported;
            this.skipped = skipped;
            this.message = message;
        }
    }

    static Result scan(Context context) {
        return scan(context, false);
    }

    /**
     * Scans every watched folder and reports the total.
     *
     * Folders are independent: one that has become unreadable — an SD card
     * pulled, a grant revoked — must not stop the others being imported, so a
     * failure is recorded against that folder and the sweep carries on. The
     * overall result is a failure only if nothing succeeded, because that is
     * what decides whether WorkManager retries.
     */
    static Result scan(Context context, boolean force) {
        List<FolderSync.Folder> folders = FolderSync.folders(context);
        if (folders.isEmpty()) {
            return new Result(false, 0, 0, "No folder chosen");
        }
        if (ServerConfig.baseURL(context) == null || ServerConfig.token(context) == null) {
            // Signed out, or the app has never been configured. Not a failure
            // worth retrying against — the next scan after signing in will work.
            return new Result(false, 0, 0, "Not signed in");
        }

        int imported = 0;
        int skipped = 0;
        int failed = 0;
        String firstProblem = null;
        for (FolderSync.Folder folder : folders) {
            Result one = scanFolder(context, folder, force);
            imported += one.imported;
            skipped += one.skipped;
            if (!one.ok) {
                failed++;
                if (firstProblem == null) {
                    firstProblem = one.message;
                }
            }
        }

        boolean ok = failed < folders.size();
        String message;
        if (imported > 0) {
            message = imported + " imported";
        } else if (firstProblem != null) {
            message = firstProblem;
        } else {
            message = "Nothing new";
        }
        return new Result(ok, imported, skipped, message);
    }

    /**
     * @param force re-reads files this device has already dealt with.
     *
     * The normal scan skips anything it has seen, which is what keeps a
     * fifteen-minute job cheap — but it also means a workout deleted from the
     * library never comes back, because the file that produced it is still
     * marked as handled here. Forcing forgets that and offers everything again;
     * the server's content-hash check still keeps what is genuinely still there
     * from being imported twice.
     */
    private static Result scanFolder(Context context, FolderSync.Folder folder, boolean force) {
        Uri tree = folder.uri;
        String token = ServerConfig.token(context);

        DocumentFile dir = DocumentFile.fromTreeUri(context, tree);
        if (dir == null || !dir.canRead()) {
            String message = "Cannot read this folder any more";
            FolderSync.recordScan(context, tree, message);
            return new Result(false, 0, 0, message);
        }

        // Candidates: files we have never opened, in a format the server takes.
        Set<String> seen = force ? new HashSet<>() : FolderSync.seen(context, tree);
        List<DocumentFile> candidates = new ArrayList<>();
        int skipped = 0;
        for (DocumentFile file : dir.listFiles()) {
            if (!file.isFile()) {
                continue;
            }
            String name = file.getName();
            if (name == null) {
                continue;
            }
            if (!supported(name)) {
                skipped++;
                continue;
            }
            if (seen.contains(fingerprint(file))) {
                continue;
            }
            candidates.add(file);
        }
        if (candidates.isEmpty()) {
            FolderSync.recordScan(context, tree, "Nothing new");
            return new Result(true, 0, skipped, "Nothing new");
        }

        // Read and hash. Files that cannot be read are marked seen anyway: a
        // permanently unreadable file must not be retried on every scan forever.
        List<String> hashes = new ArrayList<>();
        List<byte[]> contents = new ArrayList<>();
        List<DocumentFile> readable = new ArrayList<>();
        Set<String> processed = new HashSet<>();
        for (DocumentFile file : candidates) {
            byte[] data = read(context, file);
            if (data == null) {
                processed.add(fingerprint(file));
                skipped++;
                continue;
            }
            readable.add(file);
            contents.add(data);
            hashes.add(sha256(data));
        }

        try {
            Set<String> known = known(context, token, hashes);
            int imported = 0;
            for (int i = 0; i < readable.size() && imported < MAX_UPLOADS_PER_SCAN; i++) {
                DocumentFile file = readable.get(i);
                if (known.contains(hashes.get(i))) {
                    // Already in the library — imported from another device, or
                    // by an earlier install of this one.
                    processed.add(fingerprint(file));
                    continue;
                }
                if (upload(context, token, file.getName(), contents.get(i))) {
                    processed.add(fingerprint(file));
                    imported++;
                } else {
                    // Left unmarked deliberately: a failed upload is usually the
                    // network, and the next scan should try again.
                    skipped++;
                }
            }

            FolderSync.addSeen(context, tree, processed);
            if (imported > 0) {
                finalizeImport(context, token, imported, folder.label);
            }
            String message = imported > 0 ? imported + " imported" : "Nothing new";
            FolderSync.recordScan(context, tree, message);
            return new Result(true, imported, skipped, message);
        } catch (Exception e) {
            Log.w(TAG, "scan failed", e);
            // Whatever was genuinely dealt with is still recorded, so a failure
            // halfway through does not mean starting over.
            FolderSync.addSeen(context, tree, processed);
            String message = "Could not reach the server";
            FolderSync.recordScan(context, tree, message);
            return new Result(false, 0, skipped, message);
        }
    }

    private static boolean supported(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String ext : EXTENSIONS) {
            if (lower.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Identity for "have we dealt with this file already".
     *
     * Size and modification time are included so a file replaced in place — the
     * same name, new contents — is picked up rather than ignored forever.
     */
    private static String fingerprint(DocumentFile file) {
        return file.getUri() + "|" + file.length() + "|" + file.lastModified();
    }

    /** Reads a document, transparently un-gzipping a `.gz`. */
    private static byte[] read(Context context, DocumentFile file) {
        String name = file.getName();
        boolean gzipped = name != null && name.toLowerCase(Locale.ROOT).endsWith(".gz");
        try (InputStream raw = context.getContentResolver().openInputStream(file.getUri())) {
            if (raw == null) {
                return null;
            }
            try (InputStream in = gzipped ? new GZIPInputStream(raw) : raw) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] chunk = new byte[16384];
                int read;
                while ((read = in.read(chunk)) != -1) {
                    if (out.size() + read > MAX_FILE_BYTES) {
                        Log.w(TAG, "skipping oversized file: " + name);
                        return null;
                    }
                    out.write(chunk, 0, read);
                }
                return out.toByteArray();
            }
        } catch (Exception e) {
            Log.w(TAG, "could not read " + name + ": " + e.getMessage());
            return null;
        }
    }

    /** The same SHA-256 of the file bytes the server derives, hex encoded. */
    private static String sha256(byte[] data) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xf, 16));
                hex.append(Character.forDigit(b & 0xf, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            // SHA-256 is required of every JVM; this cannot happen.
            throw new IllegalStateException(e);
        }
    }

    /** Asks the server which of these it already has. */
    private static Set<String> known(Context context, String token, List<String> hashes) throws Exception {
        Set<String> known = new HashSet<>();
        if (hashes.isEmpty()) {
            return known;
        }
        JSONObject body = new JSONObject();
        body.put("hashes", new JSONArray(hashes));

        HttpURLConnection connection = open(context, token, "/api/workouts/import/known", "POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        try {
            connection.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("known check returned " + connection.getResponseCode());
            }
            JSONObject response = new JSONObject(readAll(connection.getInputStream()));
            JSONArray list = response.optJSONArray("known");
            for (int i = 0; list != null && i < list.length(); i++) {
                known.add(list.getString(i));
            }
        } finally {
            connection.disconnect();
        }
        return known;
    }

    /**
     * Uploads one file as multipart/form-data, the same shape the web importer
     * sends.
     *
     * deferChecks is set for every file: gear and goal evaluation each read the
     * user's whole library, and running them per file is what made bulk import
     * quadratic. finalizeImport runs them once at the end.
     */
    private static boolean upload(Context context, String token, String filename, byte[] data) {
        String boundary = "----ActivityLens" + System.currentTimeMillis();
        HttpURLConnection connection = null;
        try {
            connection = open(context, token, "/api/workouts/import", "POST");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(multipartLength(boundary, filename, data));

            DataOutputStream out = new DataOutputStream(connection.getOutputStream());
            out.writeBytes("--" + boundary + "\r\n");
            out.writeBytes("Content-Disposition: form-data; name=\"deferChecks\"\r\n\r\n1\r\n");
            out.writeBytes("--" + boundary + "\r\n");
            // How it got here, which nothing else can tell: the request is
            // otherwise identical to a file the user picked by hand.
            out.writeBytes("Content-Disposition: form-data; name=\"source\"\r\n\r\nautoimport\r\n");
            out.writeBytes("--" + boundary + "\r\n");
            out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + sanitize(filename) + "\"\r\n").getBytes(StandardCharsets.UTF_8));
            out.writeBytes("Content-Type: application/octet-stream\r\n\r\n");
            out.write(data);
            out.writeBytes("\r\n--" + boundary + "--\r\n");
            out.flush();

            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_CREATED || status == HttpURLConnection.HTTP_OK) {
                return true;
            }
            // A file the parser rejects will be rejected every time, so it counts
            // as dealt with rather than as something to retry.
            Log.w(TAG, "import of " + filename + " returned " + status);
            return status == HttpURLConnection.HTTP_BAD_REQUEST || status == HttpURLConnection.HTTP_UNSUPPORTED_TYPE;
        } catch (Exception e) {
            Log.w(TAG, "upload failed for " + filename, e);
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /** Byte count of the multipart body, so it can be streamed without buffering. */
    private static long multipartLength(String boundary, String filename, byte[] data) {
        long overhead = ("--" + boundary + "\r\n").length()
            + "Content-Disposition: form-data; name=\"deferChecks\"\r\n\r\n1\r\n".length()
            + ("--" + boundary + "\r\n").length()
            + "Content-Disposition: form-data; name=\"source\"\r\n\r\nautoimport\r\n".length()
            + ("--" + boundary + "\r\n").length()
            + ("Content-Disposition: form-data; name=\"file\"; filename=\"" + sanitize(filename) + "\"\r\n").getBytes(StandardCharsets.UTF_8).length
            + "Content-Type: application/octet-stream\r\n\r\n".length()
            + ("\r\n--" + boundary + "--\r\n").length();
        return overhead + data.length;
    }

    /** Keeps a filename from breaking out of the Content-Disposition header. */
    private static String sanitize(String filename) {
        return filename == null ? "workout.gpx" : filename.replaceAll("[\"\\r\\n]", "_");
    }

    /** Runs the deferred gear and goal checks, and asks for the notification. */
    private static void finalizeImport(Context context, String token, int imported, String label) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            // Only the count and the folder. Which workouts the batch brought in
            // is the server's own question to answer — see ImportWindowStart —
            // because a timestamp from this phone depends on its clock agreeing
            // with the server's, and on every installed version sending it.
            body.put("imported", imported);
            if (label != null) {
                body.put("folder", label);
            }
            connection = open(context, token, "/api/workouts/import/finalize", "POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            connection.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));
            connection.getResponseCode();
        } catch (Exception e) {
            // The workouts are already imported; only the notification and the
            // goal check are lost, and the next scan will run them.
            Log.w(TAG, "finalize failed", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static HttpURLConnection open(Context context, String token, String path, String method) throws Exception {
        String url = ServerConfig.url(context, path);
        if (url == null) {
            throw new IllegalStateException("no server configured");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        // Bearer rather than a cookie, exactly as the WebView authenticates. No
        // CSRF token: there is no ambient credential to forge, and the server
        // does not ask for one on a bearer request.
        connection.setRequestProperty("Authorization", "Bearer " + token);
        return connection;
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) != -1) {
            out.write(chunk, 0, read);
        }
        return out.toString("UTF-8");
    }
}
