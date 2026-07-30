package io.github.blurrycontour.activitylens;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads a new APK and installs it over the running app.
 *
 * The download is streamed straight into a {@link PackageInstaller} session
 * rather than written to a file first. That is deliberate and buys three things:
 * no temporary APK is ever left on disk, no FileProvider or storage permission
 * is involved, and the user sees one continuous progress bar instead of a
 * download that finishes and then appears to stall while a second, invisible
 * copy happens.
 *
 * Android will only replace an app with a build signed by the same key. An APK
 * from a different source — a debug build over a release one, or a fork's build
 * over ours — is rejected by the system with a signature mismatch, and there is
 * nothing this code can do about that. The server hands out the APK for its own
 * version, so in the normal case both come from the same release.
 *
 * Written rather than taken as a dependency: the third-party updater plugins all
 * wrap this same API, and an unmaintained one sitting between the app and its
 * own update path is exactly the sort of thing that breaks on an Android release
 * and cannot be fixed from here.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    /** Emitted as the APK is transferred. Listened to by the update dialog. */
    private static final String PROGRESS_EVENT = "updateProgress";

    /** Broadcast action for install results. Package-scoped, never exported. */
    private static final String INSTALL_ACTION = "io.github.blurrycontour.activitylens.INSTALL_RESULT";

    /** One thread: two concurrent installs of the same app make no sense. */
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /** Held so the result broadcast can resolve the call that started it. */
    private PluginCall pendingInstall;
    private BroadcastReceiver installReceiver;

    /** What is installed right now, for comparison against what a server offers. */
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            result.put("version", info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            result.put("packageName", info.packageName);
        } catch (PackageManager.NameNotFoundException e) {
            // The app asking the package manager about itself cannot fail.
            call.reject("could not read the installed version", e);
            return;
        }
        result.put("canInstall", canRequestInstalls());
        call.resolve(result);
    }

    /**
     * Sends the user to the system screen where "install unknown apps" is
     * granted. There is no runtime-permission dialog for this one; the settings
     * screen is the only route, so an update that cannot proceed has somewhere
     * to send the user rather than simply failing.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Downloads the APK at {@code url} and hands it to the system installer.
     *
     * Resolves once the install has been confirmed by the system, so the caller
     * can keep its progress UI on screen for the whole operation — which is the
     * point: an update that leaves the screen halfway invites the user to tap
     * away and kill it.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (!canRequestInstalls()) {
            call.reject("install-not-permitted");
            return;
        }
        if (pendingInstall != null) {
            call.reject("an update is already in progress");
            return;
        }
        // Kept alive across the background work and the result broadcast.
        call.setKeepAlive(true);
        pendingInstall = call;
        executor.execute(() -> run(call, url));
    }

    /** The whole transfer, off the main thread. */
    private void run(PluginCall call, String url) {
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        int sessionId = -1;
        try {
            HttpURLConnection connection = open(url);
            long total = connection.getContentLengthLong();

            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            );
            params.setAppPackageName(getContext().getPackageName());
            if (total > 0) {
                // Lets the system reserve space up front and fail early rather
                // than part-way through a large write.
                params.setSize(total);
            }
            sessionId = installer.createSession(params);

            try (
                PackageInstaller.Session session = installer.openSession(sessionId);
                InputStream in = connection.getInputStream();
                OutputStream out = session.openWrite("app.apk", 0, total > 0 ? total : -1)
            ) {
                byte[] buffer = new byte[64 * 1024];
                long written = 0;
                // Progress is reported on a change of whole percent. Emitting per
                // buffer would put ~1500 messages a second across the bridge and
                // make the UI thread the bottleneck rather than the network.
                int lastPercent = -1;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    written += read;
                    int percent = total > 0 ? (int) (written * 100 / total) : -1;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        emitProgress("download", written, total);
                    }
                }
                session.fsync(out);
                out.close();
                in.close();
                connection.disconnect();

                emitProgress("install", total, total);
                session.commit(resultIntent().getIntentSender());
            }
            // From here the system takes over: it prompts the user, then
            // broadcasts to installReceiver, which resolves the call.
        } catch (IOException | SecurityException | IllegalArgumentException e) {
            if (sessionId != -1) {
                try {
                    installer.abandonSession(sessionId);
                } catch (Exception ignored) {
                    // Already gone; nothing useful to do or report.
                }
            }
            finish(call, false, e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        // Release assets are served as redirects to a CDN.
        connection.setInstanceFollowRedirects(true);
        connection.connect();
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("server returned " + status);
        }
        return connection;
    }

    private void emitProgress(String phase, long written, long total) {
        JSObject event = new JSObject();
        event.put("phase", phase);
        event.put("bytes", written);
        event.put("total", total);
        notifyListeners(PROGRESS_EVENT, event);
    }

    /**
     * A one-shot receiver for this install's outcome.
     *
     * Registered dynamically rather than declared in the manifest: it is only
     * relevant while an install is in flight, and a manifest receiver would be a
     * component any app on the device could see.
     */
    private PendingIntent resultIntent() {
        if (installReceiver == null) {
            installReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    handleInstallResult(intent);
                }
            };
            ContextCompat.registerReceiver(
                getContext(),
                installReceiver,
                new IntentFilter(INSTALL_ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
        }
        // MUTABLE because the system fills in the status extras before sending it.
        return PendingIntent.getBroadcast(
            getContext(),
            0,
            new Intent(INSTALL_ACTION).setPackage(getContext().getPackageName()),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
    }

    private void handleInstallResult(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        PluginCall call = pendingInstall;
        if (call == null) return;

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // The system is asking to show its own confirmation dialog. This is
            // the normal path, not an error — launch it and keep waiting.
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(confirm);
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            // Rarely reached: a successful self-update stops this process to
            // start the new one, so the app usually disappears mid-broadcast.
            finish(call, true, null);
            return;
        }

        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        finish(call, false, message != null ? message : "install failed (status " + status + ")");
    }

    /** Settles the kept-alive call exactly once and unregisters the receiver. */
    private void finish(PluginCall call, boolean ok, String error) {
        pendingInstall = null;
        if (installReceiver != null) {
            try {
                getContext().unregisterReceiver(installReceiver);
            } catch (IllegalArgumentException ignored) {
                // Not registered; nothing to undo.
            }
            installReceiver = null;
        }
        call.setKeepAlive(false);
        if (ok) {
            call.resolve();
        } else {
            call.reject(error);
        }
    }

    /** Whether the user has allowed this app to install packages. */
    private boolean canRequestInstalls() {
        return getContext().getPackageManager().canRequestPackageInstalls();
    }
}
