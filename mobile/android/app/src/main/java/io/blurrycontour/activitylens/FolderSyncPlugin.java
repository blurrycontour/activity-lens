package io.blurrycontour.activitylens;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Auto-import: watching folders for new workout files.
 *
 * Folders are chosen through the Storage Access Framework, which is the whole
 * reason this is worth doing rather than asking for storage permission. The user
 * picks a directory in the system picker and the app is granted access to that
 * directory alone — not to photos, not to documents, not to the rest of the
 * phone. There is no permission prompt because there is no permission: the act
 * of choosing *is* the grant.
 *
 * Several may be watched, because a phone that records with more than one app
 * has more than one export directory. Picking a common ancestor instead would
 * hand over far more of the filesystem than the feature needs.
 *
 * That grant is then persisted, so it survives reboots and app updates and the
 * background job can still read the folder weeks later. Without
 * takePersistableUriPermission the URI works until the process dies and then
 * silently stops, which is the failure this feature would otherwise have.
 */
@CapacitorPlugin(name = "FolderSync")
public class FolderSyncPlugin extends Plugin {

    /**
     * Re-arms the watch whenever the app starts.
     *
     * A content trigger cannot be persisted across a reboot the way an ordinary
     * job can — JobScheduler refuses the combination — so WorkManager rebuilds
     * it from its own database on boot. When that does not happen (a force stop,
     * a restore onto a new phone, an OEM that clears jobs) the watch is simply
     * gone, and nothing in the UI would say so. Re-arming here is idempotent and
     * costs a database write on launch.
     */
    @Override
    public void load() {
        FolderSyncWorker.arm(getContext());
        // Opening the app is a reason to look, and used to be one by accident.
        // See FolderSyncWorker.catchUp.
        FolderSyncWorker.catchUp(getContext());
    }

    /** Where things stand, for the Settings screen. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        JSArray folders = new JSArray();
        for (FolderSync.Folder folder : FolderSync.folders(getContext())) {
            JSObject entry = new JSObject();
            entry.put("uri", folder.uri.toString());
            entry.put("label", folder.label);
            entry.put("lastScan", folder.lastScan);
            entry.put("lastResult", folder.lastResult);
            // A folder can stop being readable without anyone touching this app:
            // an SD card removed, or a cloud provider that revoked the grant.
            // Reported so Settings can say so against that folder instead of
            // showing a watch that quietly does nothing.
            entry.put("readable", readable(folder.uri));
            folders.put(entry);
        }
        result.put("folders", folders);
        result.put("maxFolders", FolderSync.MAX_FOLDERS);
        result.put("enabled", FolderSync.enabled(getContext()));
        result.put("intervalMinutes", FolderSync.intervalMinutes(getContext()));
        // Whether Android will actually run the watch. Everything above can be
        // configured perfectly and still import nothing on a phone that has the
        // app battery-restricted, which is the single most common reason this
        // feature "does not work" — and it is invisible from inside the app
        // unless it is asked about and said out loud.
        result.put("batteryUnrestricted", batteryUnrestricted());
        call.resolve(result);
    }

    private boolean batteryUnrestricted() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /**
     * Asks to be exempt from battery optimisation.
     *
     * The system dialog, not the settings list: the list leaves the user to find
     * this app among every app on the phone, having been sent there for a reason
     * they will have forgotten by the time they arrive. Declining is fine and
     * changes nothing — the watch still runs, just whenever Android feels like
     * it, which is the behaviour being complained about.
     */
    @PluginMethod
    @SuppressLint("BatteryLife")
    public void requestBatteryExemption(PluginCall call) {
        if (batteryUnrestricted()) {
            call.resolve(new JSObject().put("batteryUnrestricted", true));
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "batteryExemptionAnswered");
    }

    @ActivityCallback
    private void batteryExemptionAnswered(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        // The result code says nothing useful — it is RESULT_CANCELED either
        // way — so the state is read back rather than inferred.
        call.resolve(new JSObject().put("batteryUnrestricted", batteryUnrestricted()));
    }

    private boolean readable(Uri tree) {
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
        return dir != null && dir.canRead();
    }

    /** Opens the system folder picker. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri tree = data != null ? data.getData() : null;
        if (tree == null) {
            // Cancelled. Not an error — resolving with nothing lets the UI leave
            // everything as it was.
            call.resolve(new JSObject().put("folder", (String) null));
            return;
        }

        // The grant has to be taken explicitly, and it is what makes this survive
        // a reboot. Read only: the app has no business writing to the folder.
        getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);

        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
        String label = dir != null && dir.getName() != null ? dir.getName() : "Selected folder";
        if (!FolderSync.addFolder(getContext(), tree, label)) {
            // At the limit. The grant was taken a moment ago and is not going to
            // be used, so it is handed straight back rather than held for
            // nothing — the system caps how many an app may keep.
            releaseGrant(tree);
            call.reject("You can watch up to " + FolderSync.MAX_FOLDERS + " folders");
            return;
        }

        JSObject response = new JSObject();
        response.put("folder", label);
        call.resolve(response);
    }

    /** Stops watching one folder, leaving the others alone. */
    @PluginMethod
    public void removeFolder(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("uri is required");
            return;
        }
        Uri tree = Uri.parse(uri);
        releaseGrant(tree);
        FolderSync.removeFolder(getContext(), tree);
        // The remaining folders are watched by one job whose triggers are fixed
        // at the moment it was armed, so it has to be rebuilt without this one.
        if (FolderSync.folders(getContext()).isEmpty()) {
            FolderSync.setEnabled(getContext(), false);
            FolderSyncWorker.cancel(getContext());
        } else {
            FolderSyncWorker.arm(getContext());
        }
        call.resolve();
    }

    /**
     * Hands a folder's grant back.
     *
     * Not merely forgetting it: the system caps how many persisted grants an app
     * may hold, and a user who picks a few folders over time should not silently
     * exhaust it.
     */
    private void releaseGrant(Uri tree) {
        try {
            getContext().getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Already gone. Nothing to do.
        }
    }

    /** Turns the periodic scan on or off. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && FolderSync.folders(getContext()).isEmpty()) {
            call.reject("choose a folder first");
            return;
        }
        FolderSync.setEnabled(getContext(), enabled);
        if (enabled) {
            FolderSyncWorker.schedule(getContext());
        } else {
            FolderSyncWorker.cancel(getContext());
        }
        call.resolve();
    }

    /**
     * Scans now, without waiting for the schedule.
     *
     * Both a convenience and the answer to "is this working?" — a periodic job
     * whose first run is up to fifteen minutes away is impossible to configure
     * with any confidence otherwise.
     */
    @PluginMethod
    public void scanNow(PluginCall call) {
        boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        // Off the main thread: this reads files and talks to the server.
        new Thread(() -> {
            FolderScanner.Result result = FolderScanner.scan(getContext(), force);
            JSObject response = new JSObject();
            response.put("ok", result.ok);
            response.put("imported", result.imported);
            response.put("skipped", result.skipped);
            response.put("message", result.message);
            call.resolve(response);
        }).start();
    }

    /**
     * Changes how often the periodic scan runs.
     *
     * A per-device setting, deliberately kept out of the database: it describes
     * this phone's battery and this phone's folder, and syncing it would mean a
     * tablet that never sees the folder dictating how often the phone looks.
     */
    @PluginMethod
    public void setInterval(PluginCall call) {
        Integer minutes = call.getInt("minutes");
        if (minutes == null) {
            call.reject("minutes is required");
            return;
        }
        FolderSync.setIntervalMinutes(getContext(), minutes);
        // Rescheduled immediately, or the new interval would not take effect
        // until something else happened to restart the job.
        if (FolderSync.enabled(getContext())) {
            FolderSyncWorker.schedule(getContext());
        }
        call.resolve();
    }

}
