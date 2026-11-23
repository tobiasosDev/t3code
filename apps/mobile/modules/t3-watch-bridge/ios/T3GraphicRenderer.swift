import UIKit
import WebKit

/// Renders an agent's HTML graphic off screen and saves it as a JPEG sized for the watch.
/// watchOS has no web view, so the watch only ever sees this picture.
final class T3GraphicRenderer: NSObject, WKNavigationDelegate {
  // Phone width keeps the page's own layout; the image is scaled down to the watch afterwards.
  private static let pageWidth: CGFloat = 360
  private static let maxPageHeight: CGFloat = 1_400
  private static let watchPixelWidth: CGFloat = 410
  private static var active: Set<T3GraphicRenderer> = []

  private let webView: WKWebView
  private var completion: ((URL?) -> Void)?

  static func render(_ url: URL, completion: @escaping (URL?) -> Void) {
    let renderer = T3GraphicRenderer(completion: completion)
    active.insert(renderer)
    renderer.start(url)
  }

  private init(completion: @escaping (URL?) -> Void) {
    self.completion = completion
    // A short viewport makes scrollHeight report the content, not the viewport.
    webView = WKWebView(frame: CGRect(x: -4_000, y: 0, width: Self.pageWidth, height: 80))
    super.init()
    webView.navigationDelegate = self
    webView.isOpaque = true
    webView.backgroundColor = .black
    webView.scrollView.contentInsetAdjustmentBehavior = .never
  }

  private func start(_ url: URL) {
    // WebKit paints only views that sit in a window.
    let window = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first
    window?.addSubview(webView)
    webView.load(URLRequest(url: url))
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
      self?.finish(nil)
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Charts often draw after load; give them a moment before measuring.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
      self?.measureAndSnapshot()
    }
  }

  // An error page would otherwise be captured and cached on the watch as the graphic.
  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
      decisionHandler(.cancel)
      finish(nil)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(nil)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    finish(nil)
  }

  private func measureAndSnapshot() {
    let script = "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)"
    webView.evaluateJavaScript(script) { [weak self] result, _ in
      guard let self else { return }
      let height = (result as? NSNumber).map { CGFloat(truncating: $0) } ?? 480
      self.webView.frame.size.height = min(max(height, 80), Self.maxPageHeight)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        self.webView.takeSnapshot(with: nil) { image, _ in
          self.finish(image.flatMap(Self.writeJpeg))
        }
      }
    }
  }

  private static func writeJpeg(_ image: UIImage) -> URL? {
    let scale = watchPixelWidth / image.size.width
    let size = CGSize(width: watchPixelWidth, height: (image.size.height * scale).rounded())
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let data = resized.jpegData(compressionQuality: 0.8) else { return nil }
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("t3-watch-graphic-\(UUID().uuidString).jpg")
    do {
      try data.write(to: file)
      return file
    } catch {
      return nil
    }
  }

  private func finish(_ file: URL?) {
    guard let completion else { return }
    self.completion = nil
    webView.stopLoading()
    webView.removeFromSuperview()
    completion(file)
    Self.active.remove(self)
  }
}
