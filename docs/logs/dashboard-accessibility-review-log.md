# Dashboard accessibility review

## 2026-11-16

The layout-warning tests covered opening the panel and dismissing it with Escape. They never
attempted a download or moved focus inside before dismissal. A simulated HTTP 503 through the
download button exposed the missing feedback. Tabbing into the panel before Escape showed that
focus fell back to the document body. The panel now reports download failures locally and
returns focus to the warning button when dismissed.

The board's operating-system reduced-motion support did not give viewers a control on a shared
display. The footer toggle is local to the current page. It pauses continuous CSS animation and
uses the existing static rendering paths for the snowman and falling shapes simulations. The
browser scenario checks a running animation's playback state and the visible pipeline status.
Short layout transitions continue to follow the operating-system preference.

Both full-screen Update activity and Security overlays allowed wheel scrolling and programmatic
focus on the board. Their earlier tests checked geometry, content, and keyboard handling without
exercising browser background interaction. The browser regressions reproduced both escapes.
Native modal dialogs supply the focus boundary, and scroll containment covers the dialog and its
backdrop. Browsers without non-scrollable overscroll containment can still move the background.

A fixed maximum body font size stopped the wide-board heading from growing under larger root text.
The font bounds now use root-relative units, retaining the same bounds with the default root size.
The Chromium test simulates root text growth. OS-level text settings were outside that test.
