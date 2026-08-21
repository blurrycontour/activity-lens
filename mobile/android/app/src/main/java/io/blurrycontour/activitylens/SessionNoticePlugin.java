package io.blurrycontour.activitylens;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import android.widget.RemoteViews;

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
        String subText = call.getString("subText", "");
        // The one extra line the expanded view has room for: what comes after
        // the thing you are on.
        String nextUp = call.getString("nextUp", "");
        /*
         * When the rest currently running ends, in epoch milliseconds, or
         * empty when nothing is counting.
         *
         * Read as a string, and sent as one. An epoch in milliseconds is well
         * past what an int holds, so the bridge hands it over as a Long --
         * which getDouble does not convert, returning null and leaving this 0.
         * The countdown never ran, and the elapsed clock beside it always did,
         * because startedAt has always crossed as text.
         */
        long restEnds = parseMillis(call.getString("restEndsAt", ""));
        // Sets done out of the day's total, drawn as a ring.
        int done = call.getInt("done", 0);
        int total = call.getInt("total", 0);

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
            .setOnlyAlertOnce(true)
            .setContentIntent(tap);
        /*
         * A ring rather than a bar.
         *
         * A progress bar is drawn where the body line goes, so it cost the one
         * sentence saying what was being done -- and it is the least
         * informative shape available: empty at the start of a session, full
         * at the end, and unreadable in between. The same fact as a ring in
         * the large-icon slot costs no line at all, is the thing the eye lands
         * on first, and has room for the number in the middle of it.
         */
        builder.setLargeIcon(progressRing(context, done, total));

        /*
         * The body is this app's, the frame is the system's.
         *
         * DecoratedCustomViewStyle keeps the header, the icons, the expander
         * and the action buttons exactly as Android draws them everywhere
         * else, and replaces only the middle. That middle is worth owning for
         * one reason: the elapsed time. The standard template can put a
         * running clock in the header and nowhere else, where it sits beside
         * the app's name and reads as the time of day -- which is why it read
         * as 11:16 rather than as eleven minutes of training. Here it is a
         * Chronometer among the other numbers, still ticking on its own with
         * nothing re-posted to keep it moving.
         */
        long started = parseTime(startedAt);
        builder.setCustomContentView(noticeView(context, title, body, "", started, restEnds))
            .setCustomBigContentView(noticeView(context, title, body, nextUp, started, restEnds))
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle());

        /*
         * Ending the session from the shade.
         *
         * Both actions open the app on the session rather than acting from
         * here, and that is deliberate rather than a shortcut. Finishing a
         * session means sending its sets to the server, and the credentials
         * for that live in the WebView's cookie jar — reachable from the app
         * and from nowhere else. A broadcast receiver could not do it without
         * a second copy of the login, held somewhere a notification action can
         * read it.
         *
         * What it costs is a screen unlock. What it buys is that both end up
         * in front of the same confirmation the buttons in the app use, which
         * says how many sets are ticked -- the one thing that cannot be
         * checked from a notification shade, and the thing worth knowing
         * before ending a session either way.
         */
        builder.addAction(actionFor(context, sessionId, "finish", R.string.session_action_finish, 1));
        builder.addAction(actionFor(context, sessionId, "discard", R.string.session_action_discard, 2));

        // Nothing in the header line but the app, the plan and the day: the
        // clock that used to live there is in the body now, where it is one of
        // the numbers rather than a timestamp.
        builder.setShowWhen(false);

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS was never granted or has been revoked. The
            // session is unaffected; there is simply nothing in the shade.
            Log.w(TAG, "not allowed to post notifications");
        }
        call.resolve();
    }

    /**
     * One action button: opens the app on this session, carrying what to do.
     *
     * A request code of its own per action, because two PendingIntents that
     * match on everything but their extras are the *same* PendingIntent as far
     * as the system is concerned — with FLAG_UPDATE_CURRENT the second would
     * quietly rewrite the first, and both buttons would do whatever was built
     * last.
     */
    private static NotificationCompat.Action actionFor(
        Context context, String sessionId, String what, int labelRes, int requestOffset
    ) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(UnifiedPushReceiver.EXTRA_LINK, "/plans/session/" + sessionId + "?do=" + what);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID + requestOffset,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // The icon is passed but never drawn: from Android 7 the standard
        // template shows action labels only. It is here so the notification is
        // still well-formed on anything older.
        return new NotificationCompat.Action.Builder(
            R.drawable.ic_stat_notify, context.getString(labelRes), pending
        ).build();
    }

    /**
     * The sets done, drawn as a ring with the percentage inside it.
     *
     * Where every other app's notification puts a photograph or an avatar --
     * the one part of a notification the eye lands on before any of the words.
     * A session has no picture, and this is the fact worth having there.
     *
     * Drawn rather than themed: the ring's colour is the app's accent, which
     * lives in resources, and its geometry has to match the fraction it is
     * showing. Both are two lines of Canvas.
     */
    private static Bitmap progressRing(Context context, int done, int total) {
        int size = 192;
        float stroke = 18f;
        int accent = ContextCompat.getColor(context, R.color.app_accent);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(stroke);
        paint.setStrokeCap(Paint.Cap.ROUND);

        RectF box = new RectF(stroke, stroke, size - stroke, size - stroke);
        // The track first, so the ring is a portion of a whole circle rather
        // than an arc floating on nothing.
        paint.setColor(Color.argb(60, Color.red(accent), Color.green(accent), Color.blue(accent)));
        canvas.drawArc(box, 0f, 360f, false, paint);

        int percent = total > 0 ? Math.max(0, Math.min(100, Math.round(done * 100f / total))) : 0;
        if (percent > 0) {
            paint.setColor(accent);
            // From twelve o'clock, clockwise: the only direction a dial goes.
            canvas.drawArc(box, -90f, percent * 3.6f, false, paint);
        }

        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(accent);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(percent >= 100 ? 54f : 64f);
        text.setFakeBoldText(true);
        // Centred on the ring rather than on the baseline, which sits low.
        Paint.FontMetrics fm = text.getFontMetrics();
        canvas.drawText(percent + "%", size / 2f, size / 2f - (fm.ascent + fm.descent) / 2f, text);
        return bitmap;
    }

    /**
     * The notification's middle: a heading, a row of numbers, and optionally
     * the line about what comes next.
     *
     * Built twice, once collapsed and once expanded, because a RemoteViews is
     * a recipe rather than a view and the two differ only in whether that last
     * line is there. Collapsed has two lines and both are spoken for.
     */
    private static RemoteViews noticeView(
        Context context, String title, String body, String next, long started, long restEnds
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.notification_session);
        views.setTextViewText(R.id.notice_title, title);
        views.setTextViewText(R.id.notice_body, body);

        /*
         * A Chronometer counts against elapsedRealtime, not against the wall
         * clock, so the base is "however long ago that was" measured on the
         * clock it does use. Handed a wall-clock timestamp it would count from
         * some moment in 1970.
         */
        long now = System.currentTimeMillis();
        if (restEnds > now) {
            views.setChronometer(R.id.notice_clock, SystemClock.elapsedRealtime() + (restEnds - now), null, true);
            // Counting down: mid-rest, "40 seconds left" is the only number
            // anyone wants from a glance at the shade. The glyph changes with
            // it, so which way the number is going is legible before it is
            // read.
            views.setImageViewResource(R.id.notice_clock_icon, R.drawable.ic_notice_break);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                views.setChronometerCountDown(R.id.notice_clock, true);
            }
        } else if (started > 0) {
            views.setChronometer(R.id.notice_clock, SystemClock.elapsedRealtime() - (now - started), null, true);
            views.setImageViewResource(R.id.notice_clock_icon, R.drawable.ic_notice_clock);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                views.setChronometerCountDown(R.id.notice_clock, false);
            }
        } else {
            // No clock and no glyph for it: half a pair says less than none.
            views.setViewVisibility(R.id.notice_clock, android.view.View.GONE);
            views.setViewVisibility(R.id.notice_clock_icon, android.view.View.GONE);
        }

        if (next != null && !next.isEmpty()) {
            views.setTextViewText(R.id.notice_next, next);
            views.setViewVisibility(R.id.notice_next_row, android.view.View.VISIBLE);
        }
        return views;
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /** Digits to epoch milliseconds, or 0 when there are none. */
    private static long parseMillis(String value) {
        if (value == null || value.isEmpty()) {
            return 0;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            Log.w(TAG, "unparseable timestamp: " + value);
            return 0;
        }
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
