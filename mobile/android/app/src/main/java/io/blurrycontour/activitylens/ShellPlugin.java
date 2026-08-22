package io.blurrycontour.activitylens;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * The things a WebView cannot do for itself.
 *
 * Saving a file, and vibrating. In a browser the app builds a Blob, points an
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
    /**
     * Vibrates, with a pattern.
     *
     * `navigator.vibrate` exists in the WebView and is the obvious way to do
     * this, but it has now failed twice in ways that report nothing: without
     * the VIBRATE permission it is silently ignored while still returning
     * true, and Chrome drops the call outright whenever the page is not
     * visible — which, during a rest with the phone in a pocket, is exactly
     * when the buzz is the whole point. The system Vibrator has neither
     * problem and says so when it is not there.
     *
     * The pattern is the same shape the web API takes: milliseconds on, off,
     * on, and so forth.
     */
    @PluginMethod
    public void vibrate(PluginCall call) {
        JSArray raw = call.getArray("pattern");
        long[] pattern;
        try {
            List<Object> values = raw == null ? null : raw.toList();
            if (values == null || values.isEmpty()) {
                call.reject("pattern is required");
                return;
            }
            pattern = new long[values.size() + 1];
            // A waveform alternates off/on and starts with off, where the web
            // API's first number is already an on. One leading zero makes the
            // two the same list.
            pattern[0] = 0;
            for (int i = 0; i < values.size(); i++) {
                pattern[i + 1] = Math.max(0, Math.min(5000, ((Number) values.get(i)).longValue()));
            }
        } catch (Exception e) {
            call.reject("pattern must be a list of milliseconds");
            return;
        }

        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) {
            // A tablet with no motor. Reported rather than swallowed, so the
            // caller can stop offering something this device cannot do.
            call.reject("no vibrator");
            return;
        }
        /*
         * A single pulse is a one-shot, not a waveform of one.
         *
         * This is the difference between the buzz that ends a session and the
         * buzz that throws one away: identical code, identical moment, and the
         * only thing that is not the same is that discard's pattern has one
         * entry and finish's has five. A one-entry pattern becomes the
         * waveform {0, n} -- wait nothing, then buzz -- which is a legal thing
         * to ask for and which some devices decline to render at all. The
         * platform has an API for exactly this case, and it is the one that
         * works. Every pattern with a real rhythm still goes the waveform way.
         *
         * -1 is "do not repeat": a pattern that loops has to be cancelled by
         * someone, and nothing here would be alive to do it.
         */
        // createOneShot refuses a zero-length buzz, which a hand-edited or
        // future pattern could ask for; a waveform simply does nothing for it.
        VibrationEffect effect = pattern.length == 2 && pattern[1] > 0
            ? VibrationEffect.createOneShot(pattern[1], VibrationEffect.DEFAULT_AMPLITUDE)
            : VibrationEffect.createWaveform(pattern, -1);
        vibrator.vibrate(effect);
        call.resolve();
    }

    /**
     * Records the accent the user picked, for the parts of the app Java draws.
     *
     * See Accent: notifications are built without a WebView in sight, so the
     * colour has to be somewhere that outlives the page.
     */
    @PluginMethod
    public void setAccent(PluginCall call) {
        String color = call.getString("color", "");
        if (color.isEmpty()) {
            call.reject("color is required");
            return;
        }
        Accent.set(getContext(), color);
        call.resolve();
    }

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
     * Hands a file to the Android share sheet.
     *
     * Distinct from saveFile, and both are needed: saving answers "keep this",
     * sharing answers "send this to someone", and a user who wanted the second
     * is not served by a file appearing in Downloads for them to go and find.
     *
     * The bytes go to the cache directory rather than anywhere durable — the
     * receiving app copies what it needs, and a share card is a thing you send
     * rather than a thing you keep. Android clears that directory itself, so
     * nothing here has to remember to.
     *
     * navigator.share exists in a browser and does this for free; the Android
     * WebView does not implement it, which is why this is here at all.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String filename = call.getString("filename");
        String base64 = call.getString("base64");
        if (filename == null || filename.isEmpty() || base64 == null) {
            call.reject("filename and base64 are required");
            return;
        }
        String mime = call.getString("mime", "application/octet-stream");
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("file contents were not valid base64");
            return;
        }

        try {
            // A fixed subdirectory, so repeated shares reuse it rather than
            // filling the cache with one directory each.
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("could not prepare the file for sharing");
                return;
            }
            File out = new File(dir, filename);
            try (FileOutputStream stream = new FileOutputStream(out)) {
                stream.write(bytes);
            }

            // A file:// URI would throw FileUriExposedException on anything
            // since Android 7; the provider is already declared in the manifest
            // for exactly this.
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                out
            );

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text");
            if (text != null && !text.isEmpty()) {
                send.putExtra(Intent.EXTRA_TEXT, text);
            }
            // Without this the receiving app has no permission to read the URI
            // it was just handed, and the share silently produces nothing.
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not share the file: " + e.getMessage(), e);
        }
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
