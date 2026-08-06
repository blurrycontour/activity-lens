package io.blurrycontour.activitylens;

import android.content.Context;
import android.net.Uri;
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
 * Runs the folder scan with the app closed — when a file appears, not on a
 * timer.
 *
 * Android will watch a content URI on an app's behalf and start a job when it
 * changes: JobScheduler's trigger content URIs, which WorkManager exposes as
 * {@code addContentUriTrigger}. A DocumentsProvider calls notifyChange on a
 * directory's children URI whenever something is added to or removed from it, so
 * registering against that URI is the OS telling us about a new workout file
 * rather than us asking every fifteen minutes whether there is one. No
 * foreground service, no permanent notification, and the phone is not woken at
 * all on the days nothing is recorded.
 *
 * Two jobs, because a trigger alone would quietly miss things:
 *
 *   1. the watch — a one-shot with a content trigger, which re-arms itself each
 *      time it runs, since a trigger job is consumed by firing
 *   2. the backstop — a periodic scan, now six-hourly rather than quarter-hourly
 *
 * The backstop is not belt-and-braces. A file that lands while the phone is off
 * generates no notification anyone is listening for, and a provider is under no
 * obligation to call notifyChange at all — cloud-backed ones frequently do not.
 * The trigger is what makes the common case immediate; the schedule is what
 * makes the feature honest about "it will not be missed".
 *
 * Neither escapes Doze. The OS still decides when to run these, and a phone with
 * the app battery-restricted will run them late or not at all — which is what
 * FolderSyncPlugin surfaces in Settings rather than leaving to be discovered.
 */
public class FolderSyncWorker extends Worker {

    /** The periodic safety net. */
    private static final String WORK_NAME = "folder-sync";
    /** The content-triggered watch, re-armed after every run. */
    private static final String WATCH_NAME = "folder-sync-watch";

    /**
     * How long to let changes settle before running.
     *
     * A file being written arrives as a burst of notifications, and starting on
     * the first one means reading a half-written GPX. Waiting for a gap costs a
     * few seconds against a fifteen-minute floor, and the max delay is the
     * promise that a folder being written to continuously still gets scanned.
     */
    private static final long TRIGGER_SETTLE_SECONDS = 15;
    private static final long TRIGGER_MAX_DELAY_MINUTES = 5;

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
        Uri children = FolderSync.childrenUri(context);
        if (children == null) {
            return;
        }
        Constraints constraints = new Constraints.Builder()
            // No point waking up to upload with no network. WorkManager holds the
            // job until there is one rather than running it and failing.
            .setRequiredNetworkType(NetworkType.CONNECTED)
            // true: descendants too, so a recorder that files workouts into
            // dated subfolders is still noticed. The scan itself only reads the
            // top level, but a new subfolder appearing is worth looking at.
            .addContentUriTrigger(children, true)
            .setTriggerContentUpdateDelay(TRIGGER_SETTLE_SECONDS, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(TRIGGER_MAX_DELAY_MINUTES, TimeUnit.MINUTES)
            .build();
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
     * something.
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
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        WorkManager.getInstance(context).cancelUniqueWork(WATCH_NAME);
    }
}
