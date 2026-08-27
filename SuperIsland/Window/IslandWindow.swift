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

        applyLevel(forExpanded: false)
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

    /// Menu bar managers (Ice, Bartender, HiddenBar) draw their overflow
    /// bars at the .statusBar level, and within one level whichever window
    /// ordered last wins. While the island is expanded it sits one step
    /// above .statusBar so such a bar can never cover the opened island
    /// (still below .popUpMenu, so menus and dropdowns stay on top). While
    /// compact it stays at .statusBar — an idle pill floating above the
    /// manager's bar would read as stray fragments in the menu bar.
    func applyLevel(forExpanded expanded: Bool) {
        level = expanded
            ? NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
            : .statusBar
    }
}
