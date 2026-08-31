package com.ginga.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int WEB_PERMISSIONS_REQUEST = 4301;
    private static final int FILE_CHOOSER_REQUEST = 4302;

    private WebView webView;
    private PermissionRequest pendingWebPermissionRequest;
    private ValueCallback<Uri[]> pendingFileCallback;
    private Uri trustedServerOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        trustedServerOrigin = Uri.parse(BuildConfig.GINGA_SERVER_URL);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " GingaAndroid/0.2.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && isTrustedOrigin(uri)) {
                    view.loadUrl(uri.toString());
                    return true;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Nao foi possivel abrir este link.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    pendingFileCallback = null;
                    Toast.makeText(MainActivity.this, "Nenhum seletor de arquivos disponivel.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.GINGA_SERVER_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        requestNotificationPermissionIfNeeded();
    }

    private boolean isTrustedOrigin(Uri uri) {
        if (uri == null || trustedServerOrigin == null) return false;
        int uriPort = uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
        int trustedPort = trustedServerOrigin.getPort() == -1 ? ("https".equalsIgnoreCase(trustedServerOrigin.getScheme()) ? 443 : 80) : trustedServerOrigin.getPort();
        return "https".equalsIgnoreCase(uri.getScheme())
            && "https".equalsIgnoreCase(trustedServerOrigin.getScheme())
            && trustedServerOrigin.getHost() != null
            && trustedServerOrigin.getHost().equalsIgnoreCase(uri.getHost())
            && trustedPort == uriPort;
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (!isTrustedOrigin(request.getOrigin())) {
            request.deny();
            return;
        }

        List<String> androidPermissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.CAMERA);
            }
        }

        if (Build.VERSION.SDK_INT >= 31
            && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            androidPermissions.add(Manifest.permission.BLUETOOTH_CONNECT);
        }

        if (androidPermissions.isEmpty()) {
            request.grant(request.getResources());
            return;
        }

        pendingWebPermissionRequest = request;
        requestPermissions(androidPermissions.toArray(new String[0]), WEB_PERMISSIONS_REQUEST);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4303);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != WEB_PERMISSIONS_REQUEST || pendingWebPermissionRequest == null) return;

        PermissionRequest request = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;

        boolean allGranted = true;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }

        if (allGranted) request.grant(request.getResources());
        else request.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        pendingFileCallback.onReceiveValue(result);
        pendingFileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
