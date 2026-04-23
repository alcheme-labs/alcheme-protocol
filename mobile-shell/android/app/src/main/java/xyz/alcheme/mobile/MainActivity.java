package xyz.alcheme.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String NATIVE_WALLET_CALLBACK_EVENT = "alcheme:native-wallet-callback";
    private static final String NATIVE_WALLET_URL_SCHEME = "alcheme";
    private static final String NATIVE_WALLET_CALLBACK_HOST = "wallet";
    private static final String NATIVE_WALLET_CALLBACK_PATH = "/callback";

    private String pendingWalletCallbackUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerNativeWalletBridge();
        handleWalletCallbackIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWalletCallbackIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        flushPendingWalletCallback();
    }

    private void registerNativeWalletBridge() {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        bridge.getWebView().addJavascriptInterface(new NativeWalletBridge(), "AlchemeNativeBridge");
    }

    private void handleWalletCallbackIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        Uri data = intent.getData();
        if (!isWalletCallback(data)) {
            return;
        }

        pendingWalletCallbackUrl = data.toString();
        flushPendingWalletCallback();
    }

    private boolean isWalletCallback(Uri url) {
        if (url == null) {
            return false;
        }

        String scheme = url.getScheme();
        String host = url.getHost();
        String path = url.getPath();

        return NATIVE_WALLET_URL_SCHEME.equalsIgnoreCase(scheme)
            && NATIVE_WALLET_CALLBACK_HOST.equalsIgnoreCase(host)
            && path != null
            && path.startsWith(NATIVE_WALLET_CALLBACK_PATH);
    }

    private void flushPendingWalletCallback() {
        if (pendingWalletCallbackUrl == null || bridge == null || bridge.getWebView() == null) {
            return;
        }

        final String callbackUrl = pendingWalletCallbackUrl;
        pendingWalletCallbackUrl = null;

        bridge.executeOnMainThread(
            () -> bridge
                .getWebView()
                .evaluateJavascript(buildWalletCallbackScript(callbackUrl), null)
        );
    }

    private String buildWalletCallbackScript(String callbackUrl) {
        String escapedUrl = JSONObject.quote(callbackUrl);
        return "window.__ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__ = " + escapedUrl + ";"
            + "window.dispatchEvent(new CustomEvent('"
            + NATIVE_WALLET_CALLBACK_EVENT
            + "', { detail: { url: "
            + escapedUrl
            + " } }));";
    }

    private void openExternalUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Wallet app missing or URL unsupported. We'll surface this in the web layer later.
        }
    }

    private final class NativeWalletBridge {
        @JavascriptInterface
        public void postMessage(String payload) {
            if (payload == null || payload.trim().isEmpty()) {
                return;
            }

            try {
                JSONObject json = new JSONObject(payload);
                String type = json.optString("type", "");

                if ("openExternalUrl".equals(type)) {
                    openExternalUrl(json.optString("url", ""));
                }
            } catch (Exception ignored) {
                // Ignore malformed bridge messages from the web layer.
            }
        }
    }
}
