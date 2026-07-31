package io.blurrycontour.activitylens;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Fetches the avatar that goes on a notification, and makes it look like the one
 * the web app shows.
 *
 * The payload carries the actor's avatar as a path — the same field the service
 * worker passes to `showNotification({ icon })` — so both platforms draw the same
 * picture from one server-side decision. Resolving it needs the server address,
 * which only the app knows, so it is read back out of the store the web app
 * wrote it to.
 *
 * Avatar routes are unauthenticated by design (see handleAutoAvatar in
 * account.go): an OS notification fetches them from outside any session, on web
 * and here alike. Nothing here has a token, and nothing here needs one.
 */
final class NotificationImages {

    private NotificationImages() {}

    private static final String TAG = "UnifiedPush";

    /**
     * Notification large icons are displayed at around 64dp. Anything larger is
     * downscaled by the system anyway, and a full-size avatar decoded into a
     * BroadcastReceiver's heap for the privilege is worth avoiding.
     */
    private static final int TARGET_PX = 256;

    /** A hostile or misconfigured server must not be able to exhaust memory here. */
    private static final int MAX_BYTES = 2 * 1024 * 1024;

    /** Short: the notification is already on screen waiting for this. */
    private static final int TIMEOUT_MS = 5000;

    /**
     * Downloads the avatar named by the payload and returns it as a circle.
     *
     * Returns null for anything that does not work out — no server configured,
     * an unreachable host, a body that is not an image. The caller shows the
     * notification without it, which is exactly what the web app does when the
     * icon fails to load.
     */
    static Bitmap avatar(Context context, String iconPath) {
        if (iconPath == null || iconPath.isEmpty()) {
            return null;
        }
        String url = absolute(context, iconPath);
        if (url == null) {
            return null;
        }
        Bitmap raw = download(url);
        return raw == null ? null : circular(raw);
    }

    /**
     * Turns the payload's icon into a URL.
     *
     * The server sends a root-relative path ("/api/avatars/…"), which the web app
     * resolves against its own origin for free. Native has no origin, so the
     * configured server supplies one.
     */
    private static String absolute(Context context, String iconPath) {
        if (iconPath.startsWith("http://") || iconPath.startsWith("https://")) {
            return iconPath;
        }
        return ServerConfig.url(context, iconPath);
    }

    private static Bitmap download(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                return null;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] chunk = new byte[8192];
                int read;
                while ((read = in.read(chunk)) != -1) {
                    if (buffer.size() + read > MAX_BYTES) {
                        return null;
                    }
                    buffer.write(chunk, 0, read);
                }
            }
            byte[] bytes = buffer.toByteArray();

            // Measured first, then decoded at a sample size: decoding a large
            // avatar at full resolution only to shrink it is the usual way an
            // image load runs a process out of memory.
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        } catch (Exception e) {
            Log.i(TAG, "could not load notification avatar: " + e.getMessage());
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static int sampleSize(int width, int height) {
        int size = Math.max(width, height);
        int sample = 1;
        while (size / sample > TARGET_PX * 2) {
            sample *= 2;
        }
        return sample;
    }

    /**
     * Crops to a circle, centred on the shorter edge.
     *
     * Done here rather than left to the platform because the platform is not
     * consistent about it: Android 12 and later clip a large icon to a circle,
     * earlier versions show it square. The web app's avatars are circular
     * everywhere, so cropping ourselves is what makes the notification match the
     * app on every phone rather than on recent ones.
     */
    private static Bitmap circular(Bitmap source) {
        int size = Math.min(source.getWidth(), source.getHeight());
        if (size <= 0) {
            return null;
        }
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        BitmapShader shader = new BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        // Centres a non-square avatar instead of anchoring it top-left, which
        // would cut the top off a portrait photo.
        android.graphics.Matrix matrix = new android.graphics.Matrix();
        matrix.setTranslate(-(source.getWidth() - size) / 2f, -(source.getHeight() - size) / 2f);
        shader.setLocalMatrix(matrix);
        paint.setShader(shader);
        float radius = size / 2f;
        canvas.drawCircle(radius, radius, radius, paint);
        if (source != output) {
            source.recycle();
        }
        return output;
    }
}
