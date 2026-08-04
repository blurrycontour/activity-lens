package io.blurrycontour.activitylens;

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
     * Emitted instead of drawing a notification, when the app is already on
     * screen to show it itself.
     */
    private static final String MESSAGE_EVENT = "message";

    /**
     * Whether the app is in the foreground.
     *
     * Volatile because it is written from the main thread and read from whatever
     * thread a broadcast arrives on.
     */
    private static volatile boolean foreground = false;

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
        foreground = false;
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    /**
     * Hands a push to the running app instead of the notification tray.
     *
     * The web app does this through the service worker: a push that arrives
     * while a window is visible becomes an in-app banner, because being
     * interrupted by a system notification for something already on screen is
     * noise. This is the same rule for the same reason.
     *
     * Returns false unless it is genuinely certain the app will show it, and the
     * caller then draws the notification as usual. All three conditions matter:
     * the plugin has to exist, the app has to be in front, and the page has to
     * have subscribed. Without that last one a push arriving in the half second
     * between the WebView starting and the listener attaching would be handed to
     * nobody and silently lost — a dropped notification is a far worse failure
     * than a redundant one.
     */
    static boolean deliverInApp(JSObject payload) {
        UnifiedPushPlugin plugin = instance;
        if (plugin == null || !foreground || !plugin.hasListeners(MESSAGE_EVENT)) {
            return false;
        }
        plugin.notifyListeners(MESSAGE_EVENT, payload);
        return true;
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
        result.put("enabled", UnifiedPush.enabled(getContext()));
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
        String current = UnifiedPush.distributor(getContext());
        // Only a *different* distributor is given back first, so the old one is
        // not left holding a live endpoint the server has since replaced.
        //
        // Re-registering with the same one used to unregister first too, and
        // that is what made every re-registration mint a fresh ntfy topic: the
        // UNREGISTER deleted the subscription, so the REGISTER that followed had
        // nothing to recognise and issued a new endpoint. Registering over the
        // top is idempotent by design — the distributor answers NEW_ENDPOINT
        // with the endpoint it already has.
        if (current != null && !current.equals(distributor)) {
            UnifiedPush.unregister(getContext());
        }
        UnifiedPush.register(getContext(), distributor);
        call.resolve();
    }

    /**
     * Re-asserts an existing registration, if there is one.
     *
     * UnifiedPush expects a connector to register on every app start, and this
     * is why: the registration lives in the distributor, and it can go away
     * without anything telling us — the user deletes the subscription in ntfy,
     * the distributor clears its data, its server drops it. Our endpoint stays
     * in SharedPreferences looking perfectly healthy, the server keeps posting
     * to a topic nobody is subscribed to, and notifications silently stop.
     *
     * Registering again costs one broadcast and is idempotent: an intact
     * registration comes back with the same endpoint, a lost one is recreated.
     * The answer arrives as NEW_ENDPOINT either way, so the web app learns about
     * a changed endpoint through the path it already has.
     */
    @PluginMethod
    public void refresh(PluginCall call) {
        String distributor = UnifiedPush.distributor(getContext());
        // Keyed on the user's intent rather than on holding an endpoint: the
        // case worth repairing is precisely the one where the endpoint is gone.
        if (UnifiedPush.enabled(getContext()) && distributor != null) {
            UnifiedPush.register(getContext(), distributor);
        }
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
        // The activity's own intent is checked too, for the ordering where the
        // plugin loads before MainActivity has stashed it.
        UnifiedPush.stashTap(getContext(), getActivity().getIntent());
        String[] tap = UnifiedPush.consumeTap(getContext());
        JSObject result = new JSObject();
        if (tap != null) {
            result.put("link", tap[0]);
            result.put("id", tap[1]);
        }
        call.resolve(result);
    }

    /**
     * A tap that arrived while the app was already open.
     *
     * The event carries nothing: it is a nudge to come and take whatever is
     * waiting, and consumeTapLink is the only thing that reads it. Sending the
     * tap in the event as well would give it two homes and two chances to be
     * handled twice.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        UnifiedPush.stashTap(getContext(), intent);
        notifyListeners(TAP_EVENT, new JSObject());
    }

}
