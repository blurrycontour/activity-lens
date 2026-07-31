package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The browser half of SSO.
 *
 * Sign-in with an identity provider cannot happen inside this WebView. The
 * provider decides where it is willing to be rendered, many refuse an embedded
 * one outright, and an embedded browser is the exact shape of a credential
 * phishing page — so the platform convention, and RFC 8252's requirement, is
 * that a native app hands the flow to the real browser and gets an answer back
 * through a deep link.
 *
 * Two directions, therefore, and both live here:
 *
 *   startSSO(url)     opens the flow in a Custom Tab
 *   consumeAuthCode() collects what the deep link brought back
 *
 * A Custom Tab rather than a plain browser intent because it keeps the user
 * inside this app's task and shares the browser's cookie jar — so someone
 * already signed in to their provider is usually returned immediately, without
 * typing anything.
 */
@CapacitorPlugin(name = "NativeAuth")
public class NativeAuthPlugin extends Plugin {

    /** Emitted when a deep link arrives, so a waiting page can collect it. */
    private static final String CODE_EVENT = "authCode";

    private static final String PREFS = "native-auth";
    private static final String KEY_CODE = "pending_code";

    /** The host on our own scheme that carries a finished sign-in. */
    private static final String AUTH_HOST = "auth";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Stores the code from a deep link, wherever the app was in its lifecycle.
     *
     * Persisted rather than delivered straight to the page, for the same reason
     * the notification tap is: the browser may have sent us here from a cold
     * start, in which case there is no WebView yet, no listener, and an event
     * emitted now reaches nobody. Writing it down means whoever asks — a page
     * that was already waiting, or one that has yet to boot — gets the same
     * answer, and the ordering stops mattering.
     */
    static void stashDeepLink(Context context, Intent intent) {
        if (intent == null || intent.getData() == null) {
            return;
        }
        Uri uri = intent.getData();
        if (!AUTH_HOST.equals(uri.getHost())) {
            return;
        }
        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty()) {
            return;
        }
        prefs(context).edit().putString(KEY_CODE, code).apply();
        // Cleared off the intent so a later relaunch of the same one — a task
        // resumed from Recents, say — cannot replay a sign-in.
        intent.setData(null);
    }

    /**
     * Opens the sign-in URL in a Custom Tab, appending this build's scheme.
     *
     * The scheme is added here rather than by the caller because this is the
     * only place that knows it: the application id carries a suffix in a local
     * build so it can be installed alongside the published app, and each needs
     * its own scheme or Android cannot tell which copy to return to.
     *
     * getPackageName() rather than BuildConfig, because it is the id this app is
     * actually installed under — the same string the manifest's ${applicationId}
     * placeholder put on the intent filter. A constant compiled in from
     * somewhere else could disagree with it; this cannot.
     */
    @PluginMethod
    public void startSSO(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("a sign-in url is required");
            return;
        }
        Uri target = Uri.parse(url).buildUpon().appendQueryParameter("scheme", getContext().getPackageName()).build();
        try {
            CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            tab.launchUrl(getContext(), target);
            call.resolve();
        } catch (Exception e) {
            // No browser at all, or none that supports tabs. Nothing useful can
            // be done from here, and the page needs to say so rather than wait.
            call.reject("could not open a browser for sign-in", e);
        }
    }

    /** Hands over a stashed code, once. Returns an empty object when there is none. */
    @PluginMethod
    public void consumeAuthCode(PluginCall call) {
        SharedPreferences store = prefs(getContext());
        String code = store.getString(KEY_CODE, null);
        if (code != null) {
            store.edit().remove(KEY_CODE).apply();
        }
        JSObject result = new JSObject();
        result.put("code", code);
        call.resolve(result);
    }

    /**
     * A deep link arriving while the app is running.
     *
     * The event carries nothing: the code is in the stash, and a page that
     * missed this event still finds it there. One home for the value, one way to
     * read it — the alternative is a code that arrives twice, or by a route that
     * only works when the app happened to be open.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        stashDeepLink(getContext(), intent);
        notifyListeners(CODE_EVENT, new JSObject());
    }
}
