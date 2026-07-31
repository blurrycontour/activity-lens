package io.blurrycontour.activitylens;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * The things a WebView cannot do for itself.
 *
 * Right now that is saving a file. In a browser the app builds a Blob, points an
 * anchor at it and clicks it; in an Android WebView that does nothing at all —
 * `blob:` URLs are explicitly not handed to the system (see Bridge.launchIntent)
 * and the download attribute is not implemented. The export buttons therefore
 * appeared to work and produced no file, which is the worst kind of broken.
 *
 * Everything here is deliberately generic. A plugin named after a feature ends
 * up with the next feature bolted onto the side of it; this one is named after
 * the gap it fills.
 */
@CapacitorPlugin(
    name = "Shell",
    permissions = {
        // Only ever requested on Android 9 and older, where writing to the
        // public Downloads folder needs it. From Android 10 MediaStore handles
        // this with no permission at all, and the manifest caps the declaration
        // at API 28 so newer phones are never even asked.
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = ShellPlugin.STORAGE)
    }
)
public class ShellPlugin extends Plugin {

    static final String STORAGE = "storage";

    /**
     * A short system message.
     *
     * The app has no toast of its own — on web the browser's own download shelf
     * is the confirmation that a file was saved, and there is no equivalent
     * here. A file that lands silently in a folder the user cannot see is
     * indistinguishable from one that failed, so Android's toast stands in.
     */
    @PluginMethod
    public void toast(PluginCall call) {
        String message = call.getString("message");
        if (message == null || message.isEmpty()) {
            call.reject("message is required");
            return;
        }
        getActivity().runOnUiThread(() -> android.widget.Toast.makeText(getContext(), message, android.widget.Toast.LENGTH_LONG).show());
        call.resolve();
    }

    /**
     * Writes a file to the phone's Downloads folder.
     *
     * Downloads rather than an app-private directory, and rather than the share
     * sheet: exporting a workout is the same act as downloading it from the web
     * app, and it should land in the same place with the same name, findable
     * without knowing anything about how the app stores things.
     *
     * @param call filename, mime, and base64 — the bytes, since the bridge
     *             carries JSON and nothing else.
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename");
        String base64 = call.getString("base64");
        if (filename == null || filename.isEmpty() || base64 == null) {
            call.reject("filename and base64 are required");
            return;
        }
        // Below Android 10 there is no MediaStore path to Downloads, so the
        // permission is genuinely needed. Asked for here, at the moment it is
        // used, because that is the only moment it makes sense to a user.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState(STORAGE) != PermissionState.GRANTED) {
            requestPermissionForAlias(STORAGE, call, "storageCallback");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void storageCallback(PluginCall call) {
        if (getPermissionState(STORAGE) != PermissionState.GRANTED) {
            call.reject("storage-denied");
            return;
        }
        write(call);
    }

    private void write(PluginCall call) {
        String filename = call.getString("filename");
        String mime = call.getString("mime", "application/octet-stream");
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("file contents were not valid base64");
            return;
        }

        try {
            String path = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? writeViaMediaStore(filename, mime, bytes)
                : writeLegacy(filename, bytes);
            JSObject result = new JSObject();
            result.put("path", path);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("could not save the file: " + e.getMessage(), e);
        }
    }

    /**
     * Android 10 and later. The file is inserted into the media database and
     * written through a resolver stream; the app never touches a filesystem path
     * and needs no permission to do it. A name that is already taken is renamed
     * by the system rather than overwritten.
     */
    private String writeViaMediaStore(String filename, String mime, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        // Hides the entry from other apps until the bytes are actually there, so
        // nothing can read a half-written export.
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("Downloads is not writable");
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) {
                throw new IllegalStateException("could not open the file for writing");
            }
            out.write(bytes);
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return Environment.DIRECTORY_DOWNLOADS + "/" + filename;
    }

    /** Android 9 and older, where Downloads is an ordinary directory. */
    private String writeLegacy(String filename, byte[] bytes) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Downloads is not writable");
        }
        // MediaStore renames collisions for us; here we have to. Overwriting an
        // existing export is not ours to decide.
        File file = new File(dir, filename);
        int suffix = 1;
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String ext = dot > 0 ? filename.substring(dot) : "";
        while (file.exists()) {
            file = new File(dir, stem + " (" + suffix++ + ")" + ext);
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        // Without this the file exists but is invisible to the Files app and to
        // anything else that reads the media database.
        MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, null, null);
        return Environment.DIRECTORY_DOWNLOADS + "/" + file.getName();
    }
}
