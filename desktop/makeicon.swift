// Draws the app icon at every size macOS asks for, so `iconutil` can build the
// .icns. Run by build.sh; no design assets to keep in the repo.
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let sizes = [16, 32, 64, 128, 256, 512, 1024]

for size in sizes {
    let s = CGFloat(size)
    let image = NSImage(size: NSSize(width: s, height: s))
    image.lockFocus()

    let ctx = NSGraphicsContext.current!.cgContext
    let r = CGRect(x: 0, y: 0, width: s, height: s)

    // Rounded square with the macOS-ish corner ratio.
    let path = NSBezierPath(roundedRect: r, xRadius: s * 0.2237, yRadius: s * 0.2237)
    path.addClip()

    let colors = [
        NSColor(calibratedRed: 0.11, green: 0.16, blue: 0.29, alpha: 1).cgColor,
        NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.15, alpha: 1).cgColor,
    ] as CFArray
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
    ctx.drawLinearGradient(
        gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])

    // "SAT" wordmark, with a check mark under it at the sizes that can show one.
    let text = "SAT" as NSString
    let fontSize = s * 0.30
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: fontSize, weight: .bold),
        .foregroundColor: NSColor.white,
        .kern: s * 0.012,
    ]
    let textSize = text.size(withAttributes: attrs)
    text.draw(
        at: NSPoint(x: (s - textSize.width) / 2, y: s * 0.50),
        withAttributes: attrs)

    if size >= 64 {
        let check = NSBezierPath()
        check.lineWidth = s * 0.075
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        check.move(to: NSPoint(x: s * 0.33, y: s * 0.36))
        check.line(to: NSPoint(x: s * 0.45, y: s * 0.25))
        check.line(to: NSPoint(x: s * 0.68, y: s * 0.47))
        NSColor(calibratedRed: 0.20, green: 0.83, blue: 0.60, alpha: 1).setStroke()
        check.stroke()
    }

    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else { continue }
    try? png.write(to: URL(fileURLWithPath: "\(outDir)/icon_\(size).png"))
}
print("icons written to \(outDir)")
