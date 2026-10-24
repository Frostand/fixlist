import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = FixListBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Registers app-local native plugins on the Capacitor bridge.
class FixListBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FixListAuthPlugin())
        bridge?.registerPluginInstance(FixListPrintPlugin())
        bridge?.registerPluginInstance(FixListCapturePlugin())
        bridge?.registerPluginInstance(FixListHazardsPlugin())
        bridge?.registerPluginInstance(FixListAssistantPlugin())

        // Community screens scroll the document; retain normal WebView scrolling.
        // The classic checklist constrains scrolling inside its CSS shell.
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChangeFrame(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let webView = bridge?.webView,
              let end = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let keyboard = webView.convert(end, from: nil)
        setKeyboardInset(max(0, webView.bounds.maxY - keyboard.minY))
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        setKeyboardInset(0)
    }

    /// Tells the page how much of the screen the keyboard covers; the CSS shrinks the app shell to fit.
    private func setKeyboardInset(_ inset: CGFloat) {
        let height = Int(inset.rounded())
        bridge?.webView?.evaluateJavaScript("document.documentElement.style.setProperty('--keyboard-inset','\(height)px');document.documentElement.classList.toggle('keyboard-open',\(height > 0))")
    }
}

/// WKWebView does not support window.print(); this opens the system print sheet
/// (AirPrint, Save to Files as PDF) for the current page using its print styles.
@objc(FixListPrintPlugin)
public class FixListPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FixListPrintPlugin"
    public let jsName = "FixListPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("The report view is not available.")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("jobName") ?? "FixList report"
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, completed, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed])
                }
            }
        }
    }
}
