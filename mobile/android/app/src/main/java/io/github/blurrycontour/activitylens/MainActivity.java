package io.github.blurrycontour.activitylens;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
    }
}
