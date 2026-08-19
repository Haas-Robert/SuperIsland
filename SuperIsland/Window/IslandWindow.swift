import AppKit

final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    private static let showInScreenRecordingsDefaultsKey = "general.showInScreenRecordings"

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if QuitHotkeyGuard.shouldBlock(event) {
            return true
        }

        return super.performKeyEquivalent(with: event)
    }

    init() {
        let initialCompactSize = ScreenDetector.primaryScreen
            .flatMap(ScreenDetector.compactIslandMetrics(screen:))?
            .size ?? Constants.compactSize

        super.init(
            contentRect: NSRect(
                x: 0, y: 0,
                width: initialCompactSize.width,
                height: initialCompactSize.height
            ),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        // One step above .statusBar: menu bar managers (Ice, Bartender,
        // HiddenBar) draw their overflow bars at the .statusBar level, and
        // within the same level whichever window ordered last wins — their
        // bar would cover the island whenever it appears. Staying below
        // .popUpMenu keeps menus and dropdowns above the island.
        level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        ignoresMouseEvents = false
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = false

        let shouldShowInRecordings = UserDefaults.standard.object(
            forKey: Self.showInScreenRecordingsDefaultsKey
        ) as? Bool ?? false
        setVisibleInScreenRecordings(shouldShowInRecordings)
    }

    func setVisibleInScreenRecordings(_ visible: Bool) {
        sharingType = visible ? .readOnly : .none
    }
}
