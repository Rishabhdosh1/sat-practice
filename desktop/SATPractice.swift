// A native macOS shell around the built web app.
//
// The app is static files plus localStorage, so it needs no server and no
// Electron. A WKWebView with a custom URL scheme handler serves the Vite build
// straight out of the app bundle.
//
// A custom scheme rather than file:// because the app fetches absolute paths
// ("/data/questions.json"), which file:// cannot resolve, and because WKWebView
// blocks fetch() against file:// on CORS grounds regardless.

import AppKit
import WebKit
import UniformTypeIdentifiers

let SCHEME = "satapp"
let ORIGIN = "\(SCHEME)://local"

// MARK: - Serve the bundled build

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        // Resolve inside the bundle and refuse anything that escapes it.
        let candidate = root.appendingPathComponent(path).standardizedFileURL
        guard candidate.path.hasPrefix(root.standardizedFileURL.path) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: candidate) else {
            // A single-page app should still boot on an unknown path.
            if let index = try? Data(contentsOf: root.appendingPathComponent("index.html")) {
                respond(task: task, url: url, data: index, mime: "text/html")
            } else {
                task.didFailWithError(URLError(.fileDoesNotExist))
            }
            return
        }

        respond(task: task, url: url, data: data, mime: mimeType(for: candidate))
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(task: WKURLSchemeTask, url: URL, data: Data, mime: String) {
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                "Access-Control-Allow-Origin": "*",
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func mimeType(for url: URL) -> String {
        // UTType misses a few of these, and a wrong type on the JS bundle stops
        // the app booting, so the ones that matter are pinned explicitly.
        switch url.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default:
            return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
        }
    }
}

// MARK: - Window

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let root = Bundle.main.resourceURL!.appendingPathComponent("web")

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: SCHEME)
        // A persistent store keeps localStorage — the attempt history — across
        // launches. The default store is already persistent; being explicit
        // documents that history depends on it.
        config.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "SAT Practice"
        window.minSize = NSSize(width: 380, height: 480)
        window.contentView = webView
        window.setFrameAutosaveName("SATPracticeWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)

        buildMenu()
        webView.load(URLRequest(url: URL(string: "\(ORIGIN)/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    /// `SATPractice --selftest` boots the bundled page, checks that the app
    /// mounted and the dataset loaded, prints the result and exits. Used by
    /// build.sh to catch a broken bundle without needing a human to look.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard CommandLine.arguments.contains("--selftest") else { return }
        // callAsyncJavaScript wraps this in an async function itself, so the
        // body returns directly rather than being an IIFE.
        let probe = """
        const r = await fetch('/data/questions.json');
        const d = await r.json();
        const article = document.querySelector('article');
        return JSON.stringify({
          questions: d.questions.length,
          mounted: !!article,
          firstStem: article ? article.innerText.slice(0, 50).replace(/\\n/g, ' | ') : null,
          styled: getComputedStyle(document.body).backgroundColor,
          figures: d.questions.filter(q => q.figures.length).length
        });
        """
        // Give React a beat to mount and fetch before probing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            webView.callAsyncJavaScript(probe, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    print("SELFTEST \(value)")
                    exit(0)
                case .failure(let error):
                    print("SELFTEST FAILED \(error)")
                    exit(1)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if CommandLine.arguments.contains("--selftest") {
            print("SELFTEST NAVIGATION FAILED \(error)")
            exit(1)
        }
    }

    // Let the in-app "Export history" download reach the Downloads folder.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           url.scheme == "http" || url.scheme == "https" {
            // External links (the Desmos script is loaded by the page itself,
            // not navigated to) open in the real browser.
            if navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var dest = dir.appendingPathComponent(suggestedFilename)
        var n = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let base = (suggestedFilename as NSString).deletingPathExtension
            let ext = (suggestedFilename as NSString).pathExtension
            dest = dir.appendingPathComponent("\(base) (\(n)).\(ext)")
            n += 1
        }
        completionHandler(dest)
    }

    // MARK: Menu — so ⌘Q, ⌘W and copy/paste behave like a real app

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About SAT Practice", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide SAT Practice", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit SAT Practice", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(.separator())
        view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = view
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = win
        main.addItem(windowItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    @objc private func reload() { webView.reload() }
    @objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2.5) }
    @objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
    @objc private func zoomReset() { webView.pageZoom = 1.0 }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
