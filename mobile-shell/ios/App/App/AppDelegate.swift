import UIKit
import WebKit

private let nativeWalletBridgeName = "AlchemeNativeBridge"
private let nativeWalletIOSMessageHandler = "alchemeNativeBridge"
private let nativeWalletCallbackEvent = "alcheme:native-wallet-callback"
private let nativeWalletURLScheme = "alcheme"
private let nativeWalletCallbackHost = "wallet"
private let nativeWalletCallbackPath = "/callback"
private let nativeWalletCallbackNotification = Notification.Name("AlchemeNativeWalletCallbackNotification")

@UIApplicationMain
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var pendingWalletCallbackURL: URL?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        return true
    }

    func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard isWalletCallback(url) else {
            return false
        }

        pendingWalletCallbackURL = url
        NotificationCenter.default.post(name: nativeWalletCallbackNotification, object: url)
        return true
    }

    func consumePendingWalletCallbackURL() -> URL? {
        defer { pendingWalletCallbackURL = nil }
        return pendingWalletCallbackURL
    }

    private func isWalletCallback(_ url: URL) -> Bool {
        guard
            url.scheme?.caseInsensitiveCompare(nativeWalletURLScheme) == .orderedSame,
            url.host?.caseInsensitiveCompare(nativeWalletCallbackHost) == .orderedSame
        else {
            return false
        }

        return url.path.hasPrefix(nativeWalletCallbackPath)
    }
}

final class ShellViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var hasLoadedInitialPage = false
    private var pendingWalletCallbackURL: URL?

    private lazy var webView: WKWebView = {
        let userContentController = WKUserContentController()
        userContentController.add(self, name: nativeWalletIOSMessageHandler)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        return webView
    }()

    private lazy var messageLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = .systemFont(ofSize: 17, weight: .medium)
        label.textColor = UIColor(red: 0.96, green: 0.94, blue: 0.89, alpha: 1.0)
        label.isHidden = true
        return label
    }()

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: nativeWalletIOSMessageHandler)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureLayout()
        registerWalletCallbackObserver()
        loadShellURL()
        flushAppDelegateWalletCallback()
    }

    private func configureLayout() {
        view.backgroundColor = UIColor(red: 0.08, green: 0.1, blue: 0.09, alpha: 1.0)
        view.addSubview(webView)
        view.addSubview(messageLabel)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            messageLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            messageLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            messageLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])
    }

    private func registerWalletCallbackObserver() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWalletCallbackNotification(_:)),
            name: nativeWalletCallbackNotification,
            object: nil
        )
    }

    private func loadShellURL() {
        guard let url = ShellConfiguration.serverURL else {
            presentMessage("No mobile shell URL found.\nRun npm run mobile:sync from the frontend directory first.")
            return
        }

        webView.load(URLRequest(url: url))
    }

    private func presentMessage(_ text: String) {
        messageLabel.text = text
        messageLabel.isHidden = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedInitialPage = true
        messageLabel.isHidden = true
        flushPendingWalletCallback()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        presentMessage("Failed to load local app.\n\(error.localizedDescription)")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == nativeWalletIOSMessageHandler else {
            return
        }

        guard
            let body = message.body as? String,
            let data = body.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = json["type"] as? String
        else {
            return
        }

        if type == "openExternalUrl", let rawURL = json["url"] as? String {
            openExternalUrl(rawURL)
        }
    }

    private func openExternalUrl(_ rawURL: String) {
        guard let url = URL(string: rawURL) else {
            return
        }

        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    @objc private func handleWalletCallbackNotification(_ notification: Notification) {
        guard let url = notification.object as? URL else {
            return
        }

        handleWalletCallback(url)
    }

    private func flushAppDelegateWalletCallback() {
        guard
            let appDelegate = UIApplication.shared.delegate as? AppDelegate,
            let url = appDelegate.consumePendingWalletCallbackURL()
        else {
            return
        }

        handleWalletCallback(url)
    }

    private func handleWalletCallback(_ url: URL) {
        pendingWalletCallbackURL = url
        flushPendingWalletCallback()
    }

    private func flushPendingWalletCallback() {
        guard hasLoadedInitialPage, let callbackURL = pendingWalletCallbackURL else {
            return
        }

        pendingWalletCallbackURL = nil
        webView.evaluateJavaScript(buildWalletCallbackScript(url: callbackURL.absoluteString), completionHandler: nil)
    }

    private func buildWalletCallbackScript(url: String) -> String {
        let escapedURL = escapeJavaScriptString(url)
        return "window.__ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__ = \(escapedURL);"
            + "window.dispatchEvent(new CustomEvent('\(nativeWalletCallbackEvent)', { detail: { url: \(escapedURL) } }));"
    }

    private func escapeJavaScriptString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value], options: [])
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(json.dropFirst().dropLast())
    }
}

private enum ShellConfiguration {
    static var serverURL: URL? {
        guard
            let configURL = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
            let data = try? Data(contentsOf: configURL),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let server = json["server"] as? [String: Any],
            let rawURL = server["url"] as? String
        else {
            return nil
        }

        return URL(string: rawURL)
    }
}
