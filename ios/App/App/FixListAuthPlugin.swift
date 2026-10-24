import Foundation
import UIKit
import Capacitor
import AuthenticationServices
import Security
import CryptoKit

/// Registered in the App target and FixListBridgeViewController.
/// No session/refresh token/nonce is written to UserDefaults or logged.
@objc(FixListAuthPlugin)
public class FixListAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "FixListAuthPlugin"
    public let jsName = "FixListAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "storageGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storageSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storageRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appleSignIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openOAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLaunchUrl", returnType: CAPPluginReturnPromise)
    ]
    private var observers: [NSObjectProtocol] = []
    private var oauthSession: ASWebAuthenticationSession?
    private var oauthCall: CAPPluginCall?
    private var appleController: ASAuthorizationController?
    private var appleCall: CAPPluginCall?
    private var rawNonce: String?
    private var appleState: String?
    private var timeout: DispatchWorkItem?
    private var service: String { (Bundle.main.bundleIdentifier ?? "app.fixlist.demo") + ".auth" }

    public override func load() {
        for name in [Notification.Name.capacitorOpenURL, .capacitorOpenUniversalLink] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                guard let data = notification.object as? [String: Any], let url = data["url"] as? URL, Self.isCallback(url) else { return }
                self?.notifyListeners("authUrl", data: ["url": url.absoluteString], retainUntilConsumed: true)
            })
        }
        for (name, active) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.notifyListeners("authActive", data: ["active": active])
            })
        }
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver); timeout?.cancel(); oauthSession?.cancel() }
    private static func isCallback(_ url: URL) -> Bool {
        url.scheme == "app.fixlist.demo" && url.host == "auth" && url.path == "/callback" && url.user == nil && url.password == nil
    }
    @objc func getLaunchUrl(_ call: CAPPluginCall) {
        if let url = ApplicationDelegateProxy.shared.lastURL, Self.isCallback(url) { call.resolve(["url": url.absoluteString]) }
        else { call.resolve() }
    }
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.hasPrefix("fixlist:live:"), key.utf8.count <= 512 else { call.reject("Invalid storage key"); return nil }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
    @objc func storageGet(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }
        q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("Secure storage unavailable"); return }
        call.resolve(["value": value])
    }
    @objc func storageSet(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }
        guard let value = call.getString("value"), let data = value.data(using: .utf8), data.count <= 100_000 else { call.reject("Invalid secure value"); return }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            attributes.forEach { q[$0.key] = $0.value }
            status = SecItemAdd(q as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() } else { call.reject("Secure storage unavailable") }
    }
    @objc func storageRemove(_ call: CAPPluginCall) {
        guard let q = query(call) else { return }
        let status = SecItemDelete(q as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("Secure storage unavailable") }
    }
    private func randomValue() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
    private var anchor: ASPresentationAnchor? { bridge?.viewController?.view.window }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
    @objc func appleSignIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.appleCall == nil, self.oauthCall == nil, self.anchor != nil, let nonce = self.randomValue(), let state = self.randomValue() else { call.reject("Apple sign-in unavailable"); return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            request.state = state
            self.rawNonce = nonce; self.appleState = state; self.appleCall = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.appleController = controller; controller.delegate = self; controller.presentationContextProvider = self
            let work = DispatchWorkItem { [weak self] in self?.finishApple(error: "Apple sign-in expired") }
            self.timeout = work; DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: work)
            controller.performRequests()
        }
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard controller === appleController else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == appleState, let tokenData = credential.identityToken, let token = String(data: tokenData, encoding: .utf8), let nonce = rawNonce else { finishApple(error: "Apple sign-in failed"); return }
        let call = appleCall
        clearApple()
        call?.resolve(["token": token, "nonce": nonce]) // Raw nonce to Supabase; only SHA-256 went to Apple.
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard controller === appleController else { return }
        finishApple(error: "Apple sign-in cancelled or unavailable")
    }
    private func clearApple() { timeout?.cancel(); timeout = nil; appleCall = nil; appleController = nil; rawNonce = nil; appleState = nil }
    private func finishApple(error: String) { let call = appleCall; clearApple(); call?.reject(error) }
    @objc func openOAuth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.appleCall == nil, self.oauthCall == nil, self.anchor != nil, let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil, url.path == "/auth/v1/authorize" else { call.reject("Browser sign-in unavailable"); return }
            self.oauthCall = call
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "app.fixlist.demo") { [weak self] url, _ in
                DispatchQueue.main.async {
                    guard let self, self.oauthCall === call else { return }
                    self.timeout?.cancel(); self.timeout = nil; self.oauthCall = nil; self.oauthSession = nil
                    if let url, Self.isCallback(url) { call.resolve(["url": url.absoluteString]) }
                    else { call.reject("Browser sign-in cancelled or unavailable") }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.oauthSession = session
            let work = DispatchWorkItem { [weak self] in self?.cancelPending() }
            self.timeout = work; DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: work)
            if !session.start() { self.cancelPending() }
        }
    }
    private func cancelPending() {
        let call = oauthCall; oauthCall = nil; oauthSession?.cancel(); oauthSession = nil
        timeout?.cancel(); timeout = nil; call?.reject("Browser sign-in cancelled")
        finishApple(error: "Apple sign-in cancelled")
    }
    @objc func cancel(_ call: CAPPluginCall) { DispatchQueue.main.async { self.cancelPending(); call.resolve() } }
}
