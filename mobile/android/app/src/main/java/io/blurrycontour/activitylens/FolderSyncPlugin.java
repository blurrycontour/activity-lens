package io.blurrycontour.activitylens;

import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Auto-import: watching a folder for new workout files.
 *
 * The folder is chosen through the Storage Access Framework, which is the whole
 * reason this is worth doing rather than asking for storage permission. The user
 * picks one directory in the system picker and the app is granted access to that
 * directory alone — not to photos, not to documents, not to the rest of the
 * phone. There is no permission prompt because there is no permission: the act
 * of choosing *is* the grant.
 *
 * That grant is then persisted, so it survives reboots and app updates and the
 * background job can still read the folder weeks later. Without
 * takePersistableUriPermission the URI works until the process dies and then
 * silently stops, which is the failure this feature would otherwise have.
 */
@CapacitorPlugin(name = "FolderSync")
public class FolderSyncPlugin extends Plugin {

    /** Where things stand, for the Settings screen. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        Uri tree = FolderSync.tree(getContext());
        result.put("folder", FolderSync.label(getContext()));
        result.put("enabled", FolderSync.enabled(getContext()));
        result.put("lastScan", FolderSync.lastScan(getContext()));
        result.put("lastResult", FolderSync.lastResult(getContext()));
        // A folder can stop being readable without anyone touching this app: an
        // SD card removed, or a cloud provider that revoked the grant. Reported
        // so Settings can say so instead of showing a watch that quietly does
        // nothing.
        result.put("readable", tree != null && readable(tree));
        call.resolve(result);
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
        FolderSync.setFolder(getContext(), tree, label);

        JSObject response = new JSObject();
        response.put("folder", label);
        call.resolve(response);
    }

    /** Turns the periodic scan on or off. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && FolderSync.tree(getContext()) == null) {
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
        // Off the main thread: this reads files and talks to the server.
        new Thread(() -> {
            FolderScanner.Result result = FolderScanner.scan(getContext());
            JSObject response = new JSObject();
            response.put("ok", result.ok);
            response.put("imported", result.imported);
            response.put("skipped", result.skipped);
            response.put("message", result.message);
            call.resolve(response);
        }).start();
    }

    /** Forgets the folder and stops watching. */
    @PluginMethod
    public void disable(PluginCall call) {
        Uri tree = FolderSync.tree(getContext());
        if (tree != null) {
            try {
                // Handing the grant back rather than just forgetting it: the
                // system caps how many an app may hold, and a user who picks a
                // few folders over time should not silently exhaust it.
                getContext().getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException e) {
                // Already gone. Nothing to do.
            }
        }
        FolderSyncWorker.cancel(getContext());
        FolderSync.clear(getContext());
        call.resolve();
    }
}
