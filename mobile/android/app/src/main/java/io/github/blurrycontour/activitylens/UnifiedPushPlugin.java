package io.github.blurrycontour.activitylens;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

/**
 * Push notifications without Google, exposed to the web app.
 *
 * The protocol itself lives in {@link UnifiedPush} and the delivery path in
 * {@link UnifiedPushReceiver}; this is only the bridge. The division matters
 * because the two halves have very different lifetimes: registration happens
 * while the user is looking at Settings, and delivery happens with nothing of
 * the app running at all.
 *
 * The flow the web app drives:
 *
 *   getStatus()      what is registered right now, and whether it can be
 *   getDistributors() which distributor apps are installed
 *   register(pkg)    ask one for an endpoint
 *   unregister()     give it back
 *
 * register() resolves as soon as the request is sent, not when it succeeds — the
 * endpoint arrives asynchronously as a broadcast. The web app listens for the
 * "endpoint" event and, more importantly, re-reads getStatus() on every launch:
 * an endpoint can turn up while the app is closed, and an event nobody was there
 * to hear must not be the only way to learn about it.
 */
@CapacitorPlugin(
    name = "UnifiedPush",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = UnifiedPushPlugin.NOTIFICATIONS)
    }
)
public class UnifiedPushPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    /** Emitted when the distributor issues, changes or withdraws the endpoint. */
    private static final String ENDPOINT_EVENT = "endpoint";

    /** Emitted when a distributor refuses to register us. */
    private static final String FAILED_EVENT = "registrationFailed";

    /** Emitted when the user taps a notification that names a page. */
    private static final String TAP_EVENT = "notificationTap";

    /**
     * The live instance, so the receiver can reach the bridge.
     *
     * Static because a BroadcastReceiver is constructed by the system with no
     * reference to anything of ours, and null most of the time — the app is
     * usually not running when an endpoint arrives. That is not a lost update:
     * the receiver has already persisted the endpoint before it calls here, and
     * getStatus() is what the web app actually relies on.
     */
    private static UnifiedPushPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
    }

    static void onEndpointChanged(String endpoint) {
        UnifiedPushPlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("endpoint", endpoint);
        plugin.notifyListeners(ENDPOINT_EVENT, data);
    }

    static void onRegistrationFailed(String reason) {
        UnifiedPushPlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("reason", reason);
        plugin.notifyListeners(FAILED_EVENT, data);
    }

    /**
     * Whether push is possible at all, and where it currently stands.
     *
     * "available" is false when no distributor app is installed, which is the
     * common case on a stock phone and needs to be explained rather than shown
     * as a switch that does nothing.
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        List<UnifiedPush.Distributor> found = UnifiedPush.distributors(getContext());
        result.put("available", !found.isEmpty());
        result.put("distributor", UnifiedPush.distributor(getContext()));
        result.put("endpoint", UnifiedPush.endpoint(getContext()));
        result.put("permitted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void getDistributors(PluginCall call) {
        JSArray list = new JSArray();
        for (UnifiedPush.Distributor d : UnifiedPush.distributors(getContext())) {
            JSObject item = new JSObject();
            item.put("packageName", d.packageName);
            item.put("label", d.label);
            list.put(item);
        }
        JSObject result = new JSObject();
        result.put("distributors", list);
        call.resolve(result);
    }

    /**
     * Registers with a distributor, asking for notification permission first.
     *
     * Permission comes first deliberately: from Android 13 posting a notification
     * without it silently does nothing, so registering first would produce an
     * endpoint that appears to work and delivers nothing visible.
     */
    @PluginMethod
    public void register(PluginCall call) {
        if (call.getString("distributor") == null) {
            call.reject("distributor is required");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "permissionCallback");
            return;
        }
        doRegister(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState(NOTIFICATIONS) != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("notifications-denied");
            return;
        }
        doRegister(call);
    }

    private void doRegister(PluginCall call) {
        String distributor = call.getString("distributor");
        // Any previous registration is given back first. Leaving it would leave
        // the old distributor holding a live endpoint that the server has since
        // replaced, and it would keep delivering to a phone nobody is watching.
        if (UnifiedPush.distributor(getContext()) != null) {
            UnifiedPush.unregister(getContext());
        }
        UnifiedPush.register(getContext(), distributor);
        call.resolve();
    }

    /**
     * Removes a notification from the tray, by the id it was tagged with.
     *
     * Reading a notification in the app has to clear the banner it left in the
     * shade, or the user deals with the same thing twice. On web the service
     * worker does this; there is no service worker in the app, so the same
     * intent arrives here instead.
     */
    @PluginMethod
    public void dismiss(PluginCall call) {
        String tag = call.getString("tag");
        if (tag == null || tag.isEmpty()) {
            call.reject("tag is required");
            return;
        }
        // Tag and id together are what identify a notification, and they have to
        // match what UnifiedPushReceiver posted it with.
        NotificationManagerCompat.from(getContext()).cancel(tag, UnifiedPushReceiver.NOTIFICATION_ID);
        call.resolve();
    }

    @PluginMethod
    public void unregister(PluginCall call) {
        UnifiedPush.unregister(getContext());
        call.resolve();
    }

    /**
     * The link from a notification the user tapped, if this launch came from one.
     *
     * Polled as well as pushed, for the same reason the endpoint is: a cold start
     * from a tapped notification builds the WebView after the intent has already
     * been delivered, so an event alone would always be missed.
     */
    @PluginMethod
    public void consumeTapLink(PluginCall call) {
        JSObject result = new JSObject();
        result.put("link", takeLink(getActivity().getIntent()));
        call.resolve(result);
    }

    /** A tap that arrived while the app was already open. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String link = takeLink(intent);
        if (link == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("link", link);
        notifyListeners(TAP_EVENT, data);
    }

    /**
     * Reads the link out of an intent and removes it.
     *
     * Removed because the activity keeps its intent: without this, every later
     * call would report the same tap again, and rotating the phone would reopen
     * a page the user had navigated away from.
     */
    private static String takeLink(Intent intent) {
        if (intent == null) {
            return null;
        }
        String link = intent.getStringExtra(UnifiedPushReceiver.EXTRA_LINK);
        if (link != null) {
            intent.removeExtra(UnifiedPushReceiver.EXTRA_LINK);
        }
        return link;
    }
}
