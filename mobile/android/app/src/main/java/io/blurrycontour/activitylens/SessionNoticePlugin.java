package io.blurrycontour.activitylens;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The ongoing notification for a training session in progress.
 *
 * A session is the one thing in this app that is happening now and outlives
 * looking at the screen: the phone goes in a pocket between sets, and Android
 * is free to kill the app while it is there. An ongoing notification is how
 * the platform represents that — it stays in the shade, counts up from the
 * time the session started, and taps back into it.
 *
 * Its own channel, at low importance. This is a status, not an event: it must
 * never buzz or make a sound, and it must be silenceable without also
 * silencing the notifications that are about other people.
 */
@CapacitorPlugin(name = "SessionNotice")
public class SessionNoticePlugin extends Plugin {

    private static final String TAG = "SessionNotice";

    /**
     * Separate from UnifiedPushReceiver's channel so a user can mute one
     * without the other, and because the two want different importance.
     */
    private static final String CHANNEL_ID = "activity-lens-session";

    /**
     * A fixed id: there is only ever one session, so posting again replaces
     * the notification rather than stacking a second one.
     */
    private static final int NOTIFICATION_ID = 42;

    @PluginMethod
    public void show(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        String title = call.getString("title", "Training session");
        String body = call.getString("body", "");
        String startedAt = call.getString("startedAt", "");
        int percent = call.getInt("percent", 0);
        String subText = call.getString("subText", "");

        Context context = getContext();
        createChannel(context);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // The same deep-link extra the push notifications use, so tapping this
        // lands on the session through the app's existing routing.
        open.putExtra(UnifiedPushReceiver.EXTRA_LINK, "/plans/session/" + sessionId);

        PendingIntent tap = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ContextCompat.getColor(context, R.color.app_accent))
            .setContentTitle(title)
            .setContentText(body)
            // The plan's name, beside the app's own in the header line. It is
            // context rather than content, and putting it in the body cost a
            // line that the exercise you are on needs.
            .setSubText(subText)
            // A workout is not a message: this is what puts it with the media
            // and timer notifications rather than among the social ones.
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // Ongoing, so it cannot be swiped away while the session is open —
            // dismissing it would leave a session running with nothing saying
            // so. Finishing or discarding takes it down.
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            // How much of the day is done, as a bar. The shade shows a
            // collapsed notification most of the time, and a bar is readable
            // there in a way a second line of text is not.
            .setProgress(100, Math.max(0, Math.min(100, percent)), false);

        // Counts up from when the session started, so the shade shows how long
        // you have been training without the app having to post an update.
        long started = parseTime(startedAt);
        if (started > 0) {
            builder.setWhen(started);
            builder.setUsesChronometer(true);
        }

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS was never granted or has been revoked. The
            // session is unaffected; there is simply nothing in the shade.
            Log.w(TAG, "not allowed to post notifications");
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /** RFC 3339 to epoch milliseconds, or 0 when it cannot be read. */
    private static long parseTime(String iso) {
        if (iso == null || iso.isEmpty()) {
            return 0;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return java.time.Instant.parse(iso).toEpochMilli();
            }
        } catch (Exception e) {
            Log.w(TAG, "unparseable start time: " + iso);
        }
        return 0;
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.session_channel_name),
            // LOW: visible in the shade, never a sound or a heads-up banner.
            // A status that interrupts you every time you glance at your phone
            // mid-set is worse than no status at all.
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(context.getString(R.string.session_channel_description));
        channel.setShowBadge(false);
        NotificationManagerCompat.from(context).createNotificationChannel(channel);
    }
}
