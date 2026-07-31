package io.blurrycontour.activitylens;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * Runs the folder scan on a schedule, with the app closed.
 *
 * "Watching" a folder is the honest word for this, not the literal one. Android
 * has no way for an app to be woken when a file appears in a directory it does
 * not own; the alternative is a foreground service holding a permanent
 * notification, which is not a fair trade for importing a workout a few minutes
 * sooner. So this polls, at the shortest interval WorkManager allows.
 *
 * The OS decides when, within that interval, and batches the job with other
 * apps' work. Fifteen minutes is a floor, not a promise — a phone in Doze will
 * run it later, which is correct behaviour rather than a bug to work around.
 */
public class FolderSyncWorker extends Worker {

    private static final String WORK_NAME = "folder-sync";

    public FolderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!FolderSync.enabled(getApplicationContext())) {
            return Result.success();
        }
        FolderScanner.Result result = FolderScanner.scan(getApplicationContext());
        // retry() rather than failure() so WorkManager backs off and tries again:
        // an unreachable server is the most likely reason, and it is temporary.
        return result.ok ? Result.success() : Result.retry();
    }

    /**
     * Starts the periodic job, replacing any existing one.
     *
     * KEEP rather than REPLACE would leave an old schedule running after the
     * folder changed; REPLACE is what makes "turn it off and on again" mean
     * something.
     */
    static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            // No point waking up to upload with no network. WorkManager holds the
            // job until there is one rather than running it and failing.
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(FolderSyncWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }
}
