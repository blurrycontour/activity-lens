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
        super.onCreate(savedInstanceState);
    }
}
