package io.blurrycontour.activitylens;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * Delivers files shared into the app, or opened with it, to the page.
 *
 * The work is in {@link IncomingFiles}; this is the doorway. It mirrors
 * NativeAuthPlugin deliberately, because the problem is the same one: something
 * arrives on an intent, and the page that wants it may not exist yet.
 *
 *   consume()  collects whatever is waiting
 *   incomingFiles  says that something new has arrived
 *
 * The event carries nothing. The files are in the stash either way, so a page
 * that was not listening — one still booting on a cold start — finds them the
 * moment it asks. One place to read from, one way to read it.
 */
@CapacitorPlugin(name = "IncomingFiles")
public class IncomingFilesPlugin extends Plugin {

    /** Emitted when a share arrives while the app is already running. */
    private static final String FILES_EVENT = "incomingFiles";

    /**
     * Hands over the pending files, once.
     *
     * Each is a path to a copy this app owns, which the page turns into a URL
     * the WebView can fetch. Paths rather than the bytes themselves: a Strava
     * export can be hundreds of megabytes, and moving that across the bridge as
     * a base64 string would cost a multiple of it in memory on both sides.
     */
    @PluginMethod
    public void consume(PluginCall call) {
        JSONArray files = IncomingFiles.take(getContext());
        JSObject result = new JSObject();
        result.put("files", files);
        call.resolve(result);
    }

    /**
     * A share arriving while the app is running.
     *
     * This runs before MainActivity's own onNewIntent body, because Capacitor
     * dispatches to plugins from super.onNewIntent() and that is the first line
     * there. So the event is always fired by this, and the stash MainActivity
     * then attempts finds an intent whose payload has already been taken and
     * does nothing — which is the intended division: MainActivity's onCreate
     * covers the cold start, where no plugin is listening yet.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (IncomingFiles.stash(getContext(), intent)) {
            notifyListeners(FILES_EVENT, new JSObject());
        }
    }
}
