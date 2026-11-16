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
