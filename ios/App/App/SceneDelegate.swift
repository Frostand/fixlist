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
        bridge?.registerPluginInstance(FixListPrintPlugin())
        bridge?.registerPluginInstance(FixListCapturePlugin())
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
