package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The UnifiedPush connector protocol, and the state that goes with it.
 *
 * UnifiedPush is a broadcast protocol rather than a library: an app asks a
 * *distributor* — another app already on the phone, typically ntfy — for a push
 * endpoint, and the distributor answers with a URL that anyone can POST to. Our
 * server stores that URL and posts notifications to it. Google Play Services is
 * not involved at any point, which is the entire reason it is here: on
 * GrapheneOS and any other de-Googled Android, FCM simply does not exist.
 *
 * The protocol is four broadcasts out and four back, with a token we generate
 * tying them together. It is small enough that depending on the connector
 * library would add a transitive dependency and a version to track for less code
 * than this file.
 *
 * Everything survives process death in SharedPreferences, because it has to: the
 * distributor can hand us a new endpoint hours after the app was last opened,
 * with nothing of ours running but a BroadcastReceiver.
 */
final class UnifiedPush {

    private UnifiedPush() {}

    // Broadcasts we send to the distributor.
    static final String ACTION_REGISTER = "org.unifiedpush.android.distributor.REGISTER";
    static final String ACTION_UNREGISTER = "org.unifiedpush.android.distributor.UNREGISTER";
    static final String ACTION_MESSAGE_ACK = "org.unifiedpush.android.distributor.MESSAGE_ACK";

    // Broadcasts the distributor sends back to us.
    static final String ACTION_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT";
    static final String ACTION_REGISTRATION_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED";
    static final String ACTION_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED";
    static final String ACTION_MESSAGE = "org.unifiedpush.android.connector.MESSAGE";

    static final String EXTRA_TOKEN = "token";
    static final String EXTRA_APPLICATION = "application";
    static final String EXTRA_ENDPOINT = "endpoint";
    static final String EXTRA_BYTES_MESSAGE = "bytesMessage";
    static final String EXTRA_MESSAGE = "message";
    static final String EXTRA_MESSAGE_ID = "id";
    static final String EXTRA_REASON = "reason";

    private static final String PREFS = "unifiedpush";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_DISTRIBUTOR = "distributor";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_ENDPOINT = "endpoint";
    private static final String KEY_TAP_LINK = "tap_link";
    private static final String KEY_TAP_ID = "tap_id";

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The token identifying this app's registration, created on first use.
     *
     * The distributor echoes it back on every message, and it is how a broadcast
     * meant for us is told apart from one meant for another connector in the
     * same app. Generated once and kept, because a token that changed would
     * orphan the registration it belongs to.
     */
    static String token(Context context) {
        SharedPreferences p = prefs(context);
        String token = p.getString(KEY_TOKEN, null);
        if (token == null) {
            token = UUID.randomUUID().toString();
            p.edit().putString(KEY_TOKEN, token).apply();
        }
        return token;
    }

    static String distributor(Context context) {
        return prefs(context).getString(KEY_DISTRIBUTOR, null);
    }

    /**
     * Whether the user wants push at all.
     *
     * Deliberately separate from holding an endpoint, because the two are not
     * the same fact and treating them as one is what made a deleted ntfy
     * subscription look like a deliberate opt-out. The distributor announces
     * that loss with UNREGISTERED, which used to wipe everything — so the app
     * came back with no endpoint, no distributor to ask for a new one, and a
     * switch showing "off" that the user never touched.
     *
     * This is set by registering and cleared only by unregistering, so it means
     * exactly "the user asked for this and has not asked to stop". Everything
     * else is recoverable state, and refresh() recovers it.
     */
    static boolean enabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static String endpoint(Context context) {
        return prefs(context).getString(KEY_ENDPOINT, null);
    }

    static void setDistributor(Context context, String packageName) {
        prefs(context).edit().putString(KEY_DISTRIBUTOR, packageName).apply();
    }

    static void setEndpoint(Context context, String endpoint) {
        prefs(context).edit().putString(KEY_ENDPOINT, endpoint).apply();
    }

    /**
     * Forgets the endpoint, keeping the intent to have one.
     *
     * For losses the user did not ask for: the distributor refused us, or
     * dropped the registration because its subscription was deleted. The
     * distributor and the enabled flag stay so refresh() can ask for a new
     * endpoint on the next launch, and the token stays so the distributor
     * recognises that request as the same client rather than issuing a fresh
     * topic every time.
     */
    static void clearEndpoint(Context context) {
        prefs(context).edit().remove(KEY_ENDPOINT).apply();
    }

    /**
     * Forgets the registration entirely, including the intent to have one.
     *
     * Only for an explicit opt-out. The token still stays — see above.
     */
    static void forget(Context context) {
        prefs(context).edit().remove(KEY_DISTRIBUTOR).remove(KEY_ENDPOINT).putBoolean(KEY_ENABLED, false).apply();
    }

    /**
     * Records a notification the user tapped, so the page can act on it whenever
     * it gets around to asking.
     *
     * Stored rather than passed along, because the two are not in step. A tap
     * that starts the app cold arrives long before there is any JavaScript to
     * hand it to, and a tap while the app is running arrives at a WebView that
     * may or may not have a listener attached yet. Every ordering ends here, and
     * consumeTap is the only way out, so a tap cannot be delivered twice or
     * dropped.
     *
     * Persisted rather than held in memory because a cold start is exactly the
     * case where nothing of ours is alive to hold it.
     */
    static void stashTap(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String link = intent.getStringExtra(UnifiedPushReceiver.EXTRA_LINK);
        String id = intent.getStringExtra(UnifiedPushReceiver.EXTRA_ID);
        if (link == null && id == null) {
            return;
        }
        prefs(context).edit().putString(KEY_TAP_LINK, link).putString(KEY_TAP_ID, id).apply();
        // Removed from the intent as well: an activity keeps its intent, so
        // leaving them would let a later read find the same tap again after a
        // rotation and reopen a page the user had navigated away from.
        intent.removeExtra(UnifiedPushReceiver.EXTRA_LINK);
        intent.removeExtra(UnifiedPushReceiver.EXTRA_ID);
    }

    /** Takes the pending tap, if there is one, and forgets it. */
    static String[] consumeTap(Context context) {
        SharedPreferences p = prefs(context);
        String link = p.getString(KEY_TAP_LINK, null);
        String id = p.getString(KEY_TAP_ID, null);
        if (link == null && id == null) {
            return null;
        }
        p.edit().remove(KEY_TAP_LINK).remove(KEY_TAP_ID).apply();
        return new String[] { link, id };
    }

    /** A distributor app installed on this phone. */
    static final class Distributor {
        final String packageName;
        final String label;

        Distributor(String packageName, String label) {
            this.packageName = packageName;
            this.label = label;
        }
    }

    /**
     * Every installed app that can act as a distributor.
     *
     * Found by asking the package manager who listens for the REGISTER
     * broadcast, which is how the protocol defines discovery. Note the
     * {@code <queries>} element in AndroidManifest.xml: without it this returns
     * an empty list on Android 11 and later, where an app cannot see packages it
     * has not declared an interest in.
     */
    static List<Distributor> distributors(Context context) {
        PackageManager pm = context.getPackageManager();
        List<ResolveInfo> found = pm.queryBroadcastReceivers(new Intent(ACTION_REGISTER), 0);
        List<Distributor> out = new ArrayList<>(found.size());
        for (ResolveInfo info : found) {
            if (info.activityInfo == null) {
                continue;
            }
            String packageName = info.activityInfo.packageName;
            CharSequence label = info.activityInfo.applicationInfo != null
                ? info.activityInfo.applicationInfo.loadLabel(pm)
                : null;
            out.add(new Distributor(packageName, label != null ? label.toString() : packageName));
        }
        return out;
    }

    /**
     * Asks a distributor for an endpoint.
     *
     * The answer does not come back here — it arrives later as a NEW_ENDPOINT
     * broadcast, possibly after this process has died, which is why the token
     * and the chosen distributor are persisted before the broadcast goes out.
     */
    static void register(Context context, String distributorPackage) {
        setDistributor(context, distributorPackage);
        prefs(context).edit().putBoolean(KEY_ENABLED, true).apply();
        Intent intent = new Intent(ACTION_REGISTER);
        intent.setPackage(distributorPackage);
        intent.putExtra(EXTRA_TOKEN, token(context));
        intent.putExtra(EXTRA_APPLICATION, context.getPackageName());
        context.sendBroadcast(intent);
    }

    /** Tells the distributor to drop the registration, if there is one. */
    static void unregister(Context context) {
        String distributorPackage = distributor(context);
        if (distributorPackage != null) {
            Intent intent = new Intent(ACTION_UNREGISTER);
            intent.setPackage(distributorPackage);
            intent.putExtra(EXTRA_TOKEN, token(context));
            context.sendBroadcast(intent);
        }
        forget(context);
    }

    /**
     * Confirms a delivered message.
     *
     * A distributor that supports acknowledgement will redeliver anything it
     * never hears about, so skipping this would mean the same notification
     * arriving again on the next connection.
     */
    static void acknowledge(Context context, String messageId) {
        String distributorPackage = distributor(context);
        if (distributorPackage == null || messageId == null) {
            return;
        }
        Intent intent = new Intent(ACTION_MESSAGE_ACK);
        intent.setPackage(distributorPackage);
        intent.putExtra(EXTRA_TOKEN, token(context));
        intent.putExtra(EXTRA_MESSAGE_ID, messageId);
        context.sendBroadcast(intent);
    }
}
