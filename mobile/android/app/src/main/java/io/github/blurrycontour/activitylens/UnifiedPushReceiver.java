package io.github.blurrycontour.activitylens;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Receives everything a UnifiedPush distributor sends us, and draws the
 * notification.
 *
 * This runs with none of the app running: no WebView, no bridge, no JavaScript.
 * That constraint is what shapes the design. The message body carries the
 * notification's text, so drawing it needs no network call, no session and no
 * token handling here — the alternative, a content-free ping followed by an
 * authenticated fetch, would mean reproducing the app's auth in a receiver with
 * ten seconds to live, and would fail silently whenever the server was
 * unreachable.
 *
 * The trade-off, stated plainly because it is a real one: the distributor sees
 * the notification text. For a self-hosted ntfy that is the same trust boundary
 * as the server itself. It would not be for a public distributor, which is why
 * the payload carries a title and one line of body and nothing else — never
 * workout data, and never anything that is not already in the notification the
 * user chose to receive.
 */
public class UnifiedPushReceiver extends BroadcastReceiver {

    private static final String TAG = "UnifiedPush";

    /** One channel, so the user can silence Activity Lens without silencing everything. */
    static final String CHANNEL_ID = "activity-lens";

    /** Passed through a tapped notification so the app can open the right page. */
    static final String EXTRA_LINK = "al_notification_link";

    /**
     * The numeric half of every notification's identity. Constant because the
     * notification's own id is carried in the tag, which is a string and can be;
     * both together are what Android matches on, so anything cancelling one has
     * to use the same pair.
     */
    static final int NOTIFICATION_ID = 1;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) {
            return;
        }

        // Every broadcast carries the token we registered with. One that does not
        // match is not ours — another connector in the same app, or a stale
        // registration from before the data was cleared.
        String token = intent.getStringExtra(UnifiedPush.EXTRA_TOKEN);
        if (token != null && !token.equals(UnifiedPush.token(context))) {
            return;
        }

        switch (action) {
            case UnifiedPush.ACTION_NEW_ENDPOINT: {
                String endpoint = intent.getStringExtra(UnifiedPush.EXTRA_ENDPOINT);
                if (endpoint == null || endpoint.isEmpty()) {
                    return;
                }
                // Stored first, then announced. The app is very often not running
                // when this arrives; the stored value is what the JavaScript side
                // picks up on its next launch and sends to the server.
                UnifiedPush.setEndpoint(context, endpoint);
                UnifiedPushPlugin.onEndpointChanged(endpoint);
                break;
            }
            case UnifiedPush.ACTION_REGISTRATION_FAILED: {
                String reason = intent.getStringExtra(UnifiedPush.EXTRA_REASON);
                Log.w(TAG, "registration refused by distributor: " + reason);
                UnifiedPush.clear(context);
                UnifiedPushPlugin.onRegistrationFailed(reason);
                break;
            }
            case UnifiedPush.ACTION_UNREGISTERED: {
                UnifiedPush.clear(context);
                UnifiedPushPlugin.onEndpointChanged(null);
                break;
            }
            case UnifiedPush.ACTION_MESSAGE: {
                notify(context, messageBody(intent));
                // Acknowledged even if the payload turned out to be unreadable:
                // an unacknowledged message is redelivered forever, and a message
                // we cannot parse will not parse the second time either.
                UnifiedPush.acknowledge(context, intent.getStringExtra(UnifiedPush.EXTRA_MESSAGE_ID));
                break;
            }
            default:
                break;
        }
    }

    /** The payload, whichever of the two extras the distributor used. */
    private static String messageBody(Intent intent) {
        byte[] bytes = intent.getByteArrayExtra(UnifiedPush.EXTRA_BYTES_MESSAGE);
        if (bytes != null) {
            return new String(bytes, StandardCharsets.UTF_8);
        }
        // The original string extra, kept for distributors that still send it.
        return intent.getStringExtra(UnifiedPush.EXTRA_MESSAGE);
    }

    /**
     * Draws the notification the server sent.
     *
     * The payload is the same JSON the web push service worker receives, so both
     * platforms show the same thing from one server-side definition — the app
     * mark as the status bar icon, the actor's avatar as the picture, the accent
     * as the tint.
     *
     * It is posted twice when there is an avatar: once immediately, then again
     * with the picture once it has been fetched. Waiting for the network before
     * showing anything would delay every share notification by however long the
     * server takes to answer, and lose it entirely when the server is
     * unreachable — while a BroadcastReceiver has about ten seconds to live.
     * The second post updates the banner in place and is marked to alert only
     * once, so the user sees one notification that grows an avatar, not two.
     */
    private void notify(Context context, String payload) {
        if (payload == null || payload.isEmpty()) {
            return;
        }

        String id = null;
        String title = null;
        String body = payload;
        String link = null;
        String icon = null;
        try {
            JSONObject json = new JSONObject(payload);
            id = json.optString("id", null);
            title = json.optString("title", null);
            body = json.optString("body", "");
            link = json.optString("link", null);
            icon = json.optString("icon", null);

            // The app is on screen and listening: it shows its own banner, and a
            // system notification for something already visible would be noise.
            // Only ever true when the page is certain to receive this.
            if (UnifiedPushPlugin.deliverInApp(JSObject.fromJSONObject(json))) {
                return;
            }
        } catch (JSONException e) {
            // Not our payload — a test message sent straight to the endpoint,
            // most likely. Showing it verbatim is more useful than dropping it.
            Log.i(TAG, "message is not JSON; showing it as plain text");
        }
        if (title == null || title.isEmpty()) {
            title = context.getString(R.string.app_name);
        }

        createChannel(context);
        post(context, id, title, body, link, null);

        if (icon == null || icon.isEmpty()) {
            return;
        }
        // goAsync keeps the receiver alive past onReceive; without it the process
        // can be killed the moment this method returns. The work has to leave the
        // main thread regardless — networking on it throws.
        final PendingResult pending = goAsync();
        final String iconPath = icon;
        final String fId = id, fTitle = title, fBody = body, fLink = link;
        new Thread(() -> {
            try {
                Bitmap avatar = NotificationImages.avatar(context, iconPath);
                if (avatar != null) {
                    post(context, fId, fTitle, fBody, fLink, avatar);
                }
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** Builds and posts the notification, with the avatar when we have one. */
    private static void post(Context context, String id, String title, String body, String link, Bitmap avatar) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (link != null && !link.isEmpty()) {
            open.putExtra(EXTRA_LINK, link);
        }
        // FLAG_UPDATE_CURRENT with a per-notification request code: two pending
        // intents that differ only in their extras are otherwise considered the
        // same, and the second notification would open the first one's page.
        int requestCode = id != null ? id.hashCode() : 0;
        PendingIntent tap = PendingIntent.getActivity(
            context,
            requestCode,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            // The status bar icon, drawn from its alpha channel alone — the same
            // silhouette the web app points `badge` at, for the same reason.
            .setSmallIcon(R.drawable.ic_stat_notify)
            // Tints the small icon and the app name in the shade. The web app has
            // no equivalent knob; this is what keeps the notification recognisably
            // Activity Lens rather than system grey.
            .setColor(ContextCompat.getColor(context, R.color.app_accent))
            .setColorized(false)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            // Every notification here is about a person or a milestone, which is
            // what tells Android how to rank and group it.
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setContentIntent(tap);

        if (avatar != null) {
            // The web app's `icon`: the sender's avatar for a share, absent for a
            // system event, in which case the small icon stands alone exactly as
            // it does in the browser.
            builder.setLargeIcon(avatar);
            // This is the repost. Alerting again would buzz the phone a second
            // time for one event.
            builder.setOnlyAlertOnce(true);
        }

        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        try {
            // Tagged with the notification's own id, so the same event arriving
            // twice replaces its banner rather than stacking, so the avatar can
            // be added to this one, and so the app can dismiss one the user has
            // already read in-app.
            manager.notify(id, NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS was revoked between registering and now. Nothing
            // to do but drop it; the notification is still in the app.
            Log.w(TAG, "not allowed to post notifications");
        }
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(context.getString(R.string.notification_channel_description));
        NotificationManagerCompat.from(context).createNotificationChannel(channel);
    }
}
