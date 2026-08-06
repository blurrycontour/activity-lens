package io.blurrycontour.activitylens;

import android.content.Context;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * Runs the folder scan with the app closed.
 *
 * Three jobs, and it is worth being exact about which one does the work:
 *
 *   1. the periodic scan, every fifteen minutes — the mechanism
 *   2. the content-triggered watch — an accelerator, best-effort
 *   3. the catch-up scan when the app is opened
 *
 * Android will watch a content URI on an app's behalf and start a job when it
 * changes: JobScheduler's trigger content URIs, which WorkManager exposes as
 * {@code addContentUriTrigger}. Registering against a folder's children URI
 * therefore looks like the OS telling us about a new workout file rather than us
 * asking every fifteen minutes whether there is one.
 *
 * It is not a replacement for asking, and this was tried the other way round
 * first. A trigger only fires if something calls notifyChange, and which app
 * wrote the file decides whether anything does:
 *
 *   - an exporter that goes through SAF (Gadgetbridge, say) makes
 *     ExternalStorageProvider announce the new document, and the folder's
 *     children URI fires — import within seconds
 *   - an exporter using ordinary file I/O (Notify for Xiaomi) never touches a
 *     DocumentsProvider, so that URI is never notified at all. Confirmed on a
 *     phone rather than assumed: dumpsys showed the job registered with the
 *     right URI, every other constraint satisfied, and CONTENT_TRIGGER simply
 *     never met. The MediaStore trigger in arm() is the attempt to cover this
 *     case; whether it fires depends on MediaProvider indexing the write.
 *
 * Leaning on triggers and stretching the schedule to six hours meant files from
 * the second kind of app sat unimported until the app was next opened, which is
 * the whole feature not working. So the triggers are kept — they cost nothing,
 * and when one fires the import is immediate — but the schedule is what the
 * feature is built on, and the schedule is short.
 *
 * None of them escape Doze. The OS still decides when to run these, and a phone
 * with the app battery-restricted will run them late or not at all — which is
 * what FolderSyncPlugin surfaces in Settings rather than leaving to be
 * discovered.
 */
public class FolderSyncWorker extends Worker {

    /** The periodic scan, which is what the feature actually runs on. */
    private static final String WORK_NAME = "folder-sync";
    /** The content-triggered watch, re-armed after every run. */
    private static final String WATCH_NAME = "folder-sync-watch";
    /** The one-off sweep that runs because the app was opened. */
    private static final String CATCH_UP_NAME = "folder-sync-catchup";

    /**
     * How long to let changes settle before running.
     *
     * A file being written arrives as a burst of notifications, and starting on
     * the first one means reading a half-written GPX. Waiting for a gap costs a
     * few seconds against a fifteen-minute schedule, and the max delay is the
     * promise that a folder being written to continuously still gets scanned.
     */
    private static final long TRIGGER_SETTLE_SECONDS = 15;
    private static final long TRIGGER_MAX_DELAY_MINUTES = 5;

    /**
     * The closest together two triggered scans may run.
     *
     * Only applies to the background jobs — "Scan now" in Settings goes straight
     * to FolderScanner and is never held back, because a user who presses it is
     * asking a question and deserves an answer.
     */
    private static final long MIN_SCAN_GAP_MS = 60_000;

    public FolderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!FolderSync.enabled(context)) {
            return Result.success();
        }
        // The MediaStore trigger fires for any file written anywhere on the
        // device, so a burst of photos or a large download would otherwise mean
        // running this every twenty seconds to list a folder that has not
        // changed. Re-armed regardless, so the next genuine change is still
        // caught; only the scan is skipped.
        long since = System.currentTimeMillis() - FolderSync.lastScanAt(context);
        if (since >= 0 && since < MIN_SCAN_GAP_MS) {
            arm(context);
            return Result.success();
        }
        FolderScanner.Result result = FolderScanner.scan(context);
        // Re-armed whatever happened. A content trigger fires once and is spent,
        // so skipping this on the failure path would end the watch on the first
        // scan that ran while the server was unreachable — and nothing would
        // ever start it again but the backstop.
        arm(context);
        // retry() rather than failure() so WorkManager backs off and tries again:
        // an unreachable server is the most likely reason, and it is temporary.
        return result.ok ? Result.success() : Result.retry();
    }

    /** Starts both jobs, replacing any existing ones. */
    static void schedule(Context context) {
        arm(context);
        scheduleBackstop(context);
    }

    /**
     * Scans once, soon, because the app was opened.
     *
     * WorkManager runs overdue periodic work when the process starts, so at a
     * quarter-hourly schedule this mostly duplicates what would happen anyway.
     * It is here for when it does not: someone who suspects a file was missed
     * opens the app to check, and that is exactly when it should look rather
     * than up to fifteen minutes later.
     *
     * KEEP, so repeatedly opening the app queues one scan rather than a pile of
     * them, and separate from the watch so it cannot disturb a pending trigger.
     */
    static void catchUp(Context context) {
        if (!FolderSync.enabled(context) || FolderSync.folders(context).isEmpty()) {
            return;
        }
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FolderSyncWorker.class)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(CATCH_UP_NAME, ExistingWorkPolicy.KEEP, request);
    }

    /**
     * Registers the content trigger.
     *
     * REPLACE, and called from inside doWork above: the work is finishing, so
     * what it replaces is itself. That is the shape of a self-perpetuating
     * trigger job and it is the documented one — the alternative, a unique name
     * per run, leaks work records forever.
     *
     * Safe to call at any time. It is also called on app start, because a
     * trigger cannot be persisted across a reboot the way an ordinary job can;
     * WorkManager rebuilds it from its own database, and this is the cheap
     * insurance for the case where it did not.
     */
    static void arm(Context context) {
        if (!FolderSync.enabled(context)) {
            return;
        }
        Constraints.Builder builder = new Constraints.Builder()
            // No point waking up to upload with no network. WorkManager holds the
            // job until there is one rather than running it and failing.
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setTriggerContentUpdateDelay(TRIGGER_SETTLE_SECONDS, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(TRIGGER_MAX_DELAY_MINUTES, TimeUnit.MINUTES);
        // One job watching every folder, rather than a job each: they all run
        // the same scan, and the scan reads all of them. Which URI fired is not
        // worth knowing.
        int watched = 0;
        for (FolderSync.Folder folder : FolderSync.folders(context)) {
            Uri children = FolderSync.childrenUri(folder.uri);
            if (children != null) {
                // false: the top level only, which is what the scan reads. A
                // trigger on descendants would wake the app for changes in
                // subfolders it then ignores.
                builder.addContentUriTrigger(children, false);
                watched++;
            }
        }
        if (watched == 0) {
            return;
        }
        // And MediaStore, which is the only way to hear about the writers SAF
        // cannot see. An app exporting a file with ordinary file I/O never goes
        // through a DocumentsProvider, so nothing is announced on the folder's
        // children URI — a dumpsys of a phone doing exactly that showed the job
        // registered correctly with CONTENT_TRIGGER simply never satisfied. What
        // does happen on Android 11+ is that MediaProvider indexes the file when
        // the writer closes it, because shared storage is FUSE-backed, and that
        // notifies here.
        //
        // Descendants, because the notification arrives on the individual file's
        // URI rather than on the collection. The cost is that this fires for
        // every file written anywhere on the device, which is what the scan gap
        // in doWork is for. No permission is involved: the observing is done by
        // the system on the app's behalf, and the trigger carries no data.
        builder.addContentUriTrigger(MediaStore.Files.getContentUri("external"), true);
        Constraints constraints = builder.build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FolderSyncWorker.class)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(WATCH_NAME, ExistingWorkPolicy.REPLACE, request);
    }

    /**
     * The periodic scan.
     *
     * KEEP rather than REPLACE would leave an old schedule running after the
     * folder changed; UPDATE is what makes "turn it off and on again" mean
     * something — and what lets FolderSyncPlugin.load() call this on every app
     * start to repair a schedule that has gone missing.
     */
    private static void scheduleBackstop(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            FolderSyncWorker.class, FolderSync.intervalMinutes(context), TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    static void cancel(Context context) {
        WorkManager manager = WorkManager.getInstance(context);
        manager.cancelUniqueWork(WORK_NAME);
        manager.cancelUniqueWork(WATCH_NAME);
        manager.cancelUniqueWork(CATCH_UP_NAME);
    }
}
