package io.github.blurrycontour.activitylens;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Ask for notification permission once, not on every cold start. */
    private static final String PREFS = "shell";
    private static final String KEY_ASKED_NOTIFICATIONS = "asked_notifications";
    private static final int REQUEST_NOTIFICATIONS = 1001;

    /**
     * Registers the app's own plugins.
     *
     * Plugins that arrive as npm packages are discovered automatically through
     * the generated capacitor.plugins.json; ones that live in this module are
     * not, so they are named here. Registration must happen before
     * super.onCreate, which is when the bridge is built.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(UnifiedPushPlugin.class);
        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);

        // Replace the launch theme's window background with a flat colour.
        //
        // That background is @drawable/splash — the app mark centred on ink —
        // and it stays behind the WebView for the whole session unless it is
        // cleared. Any moment the WebView is not painting over it, it shows
        // through: a second logo behind the page during a reload, and a slice of
        // one inside Android's text-selection magnifier, which samples the
        // window surface rather than the view.
        //
        // Set here rather than in the theme because the window was created with
        // the launch theme; restyling afterwards does not repaint what the
        // window already holds. SystemBarsPlugin then keeps it in step with the
        // light/dark toggle.
        getWindow().setBackgroundDrawableResource(R.color.app_background);

        askForNotifications();
    }

    /**
     * Asks for notification permission at launch.
     *
     * It is the only runtime permission the app needs to be fully functional,
     * and asking here rather than at the moment push is switched on means the
     * user meets one system prompt on first run instead of being interrupted
     * later. Android's own guidance prefers asking in context; the trade made
     * here is deliberate, and the in-context request in UnifiedPushPlugin still
     * exists for anyone who denies it now and changes their mind.
     *
     * Asked once. Android silently refuses a third request anyway, and nagging
     * on every cold start would be worse than not having push.
     *
     * Two other permissions are declared and neither can be requested like this.
     * INTERNET is granted at install with no prompt. REQUEST_INSTALL_PACKAGES is
     * special access rather than a runtime permission: it is granted from a
     * system settings screen, which the updater opens at the point it is needed
     * rather than sending a new user there for a reason they have not met yet.
     */
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ASKED_NOTIFICATIONS, false)) {
            return;
        }
        prefs.edit().putBoolean(KEY_ASKED_NOTIFICATIONS, true).apply();
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
    }

    /**
     * Back navigates the app, rather than closing it.
     *
     * Capacitor's BridgeActivity does not touch the back button, so the platform
     * default applies and the activity finishes — from any screen. In the browser
     * the same app's back button walks the history the router pushes, so the app
     * was the only place where backing out of a workout quit to the launcher.
     *
     * goBack() is the whole fix: pushState entries are real WebView history
     * entries, so this replays exactly the popstate the router already listens
     * for. At the first entry there is nothing to go back to and the default
     * takes over, which is what leaving an app should do.
     */
    @Override
    @SuppressWarnings("deprecation") // The predictive back API is opt-in; this is the path in use.
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
