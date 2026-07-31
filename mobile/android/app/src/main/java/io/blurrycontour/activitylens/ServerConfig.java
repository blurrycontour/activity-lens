package io.blurrycontour.activitylens;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the server is and how to prove who we are, read from the app's own
 * storage.
 *
 * Both facts belong to the web app — frontend/src/lib/serverConfig.ts writes
 * them — and the native side has no business owning a second copy. What it does
 * need is to read them, because two things run with no WebView alive: the
 * notification receiver fetching an avatar, and the folder watch uploading a
 * workout.
 *
 * The coupling is to two key names in @capacitor/preferences' store. That is
 * worth stating plainly because nothing enforces it: rename a key in
 * serverConfig.ts and this reads null, so every caller treats null as "not
 * configured yet" rather than as an error, and the feature simply does not run.
 */
final class ServerConfig {

    private ServerConfig() {}

    /** @capacitor/preferences' SharedPreferences file. */
    private static final String CAPACITOR_PREFS = "CapacitorStorage";

    private static final String SERVER_URL_KEY = "al_server_url";
    private static final String TOKEN_KEY = "al_auth_token";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
    }

    /** The configured server, without a trailing slash, or null. */
    static String baseURL(Context context) {
        String base = prefs(context).getString(SERVER_URL_KEY, null);
        if (base == null || base.isEmpty()) {
            return null;
        }
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    /** The session token the app authenticates with, or null when signed out. */
    static String token(Context context) {
        String token = prefs(context).getString(TOKEN_KEY, null);
        return token == null || token.isEmpty() ? null : token;
    }

    /** Resolves an API path against the configured server. */
    static String url(Context context, String path) {
        String base = baseURL(context);
        if (base == null) {
            return null;
        }
        return path.startsWith("/") ? base + path : base + "/" + path;
    }
}
