# Terminal dashboard investigation

November 9, 2026

This was an exploratory discussion about how the dashboard might work in a Ghostty split and how much UI development the browser and terminal could share. No implementation or prototype is planned. The findings come from reading the current code and terminal documentation.

## A second client for the same board

A terminal client could read the existing [board and panel APIs](../../packages/server/src/app.ts) and use the [shared signal schemas and polling defaults](../../packages/shared/src/browser.ts). The server would continue to own source credentials, adapters, and the allowlist. The browser currently supplies dashboard access through its [OIDC sign-in flow](../oidc-authentication.md). A terminal client on a protected deployment would need a way to obtain and renew dashboard access compatible with the provider or gateway.

A wide terminal could show a grid and a narrow split could use compact rows. The important evidence carries over readily: status glyph and label, freshness, source link, and an explicit state when a reading is unavailable. Text should still communicate the state in a monochrome terminal.

## What could be developed together

[PipelinePanel](../../packages/client/src/PipelinePanel.tsx) already composes status, evidence, metadata, and an optional running field using named [panel primitives](../../packages/client/src/PanelFrame.tsx). The panel also decides which evidence to show and how to describe conditions such as loading, unreadable signals, and older results. Those decisions live alongside browser markup today.

A shared panel definition could choose the status, evidence order, link, and progress once. A small set of primitives could then render that composition as accessible HTML or terminal cells. Layout, typography, and input naturally differ between surfaces. The [browser polling hook](../../packages/client/src/usePanelSignals.ts) also combines browser lifecycle and storage with rules about polling, history, and stale results. Those rules are candidates for shared code where both clients need them.

Shared fixtures and a controlled clock would make it possible to view the same scenario in a browser and a terminal at the same time. A useful measure of the boundary is whether adding one pipeline evidence item makes it appear with the intended label and priority in both views after one edit. A shared presentation model would still carry most of that value if sharing the component composition proved awkward.

## Terminal graphics and animation

A terminal app normally sends text and control sequences. It can move the cursor, set colors, and replace the contents of particular cells. Cells make a good low-resolution tile map for progress strips, sparklines, and block art. Shapes snap to the grid, and their apparent proportions depend on the terminal font. Updating only changed cells limits output. Synchronized output lets supporting terminals present the batch together to avoid tearing. [Ghostty synchronized output](https://ghostty.org/docs/help/synchronized-output)

Ghostty also supports the Kitty graphics protocol. An application can supply raster images and place them relative to the text grid, including behind text. The protocol can store images and play animation frames. That allows fine particles, smooth motion, and transparency. It adds work to generate and transfer frames, reposition images on resize, and accommodate capability differences across terminals and multiplexers. Existing CSS effects would need a way to render into frames. Ghostty is the emulator running the app. Its embeddable VT library, `libghostty-vt`, could also consume the app's terminal output in headless tests. [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) · [Ghostty 1.4 release notes](https://ghostty.org/docs/install/release-notes/1-4-0) · [libghostty example](https://github.com/ghostty-org/ghostling)

| Current running animations                                                                | What can be shared                                                                                                                                                                                                | What needs a terminal drawing                                                                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Falling Shapes and Snowman                                                                | The seeded [falling simulation](../../packages/client/src/falling-simulation.ts) and [snow simulation](../../packages/client/src/snowman.ts), including placement, assembly, and toppling rules where applicable. | Falling Shapes maps naturally to cells. Snowman could use coarser cells or raster frames to preserve the particle detail.        |
| Flight Path                                                                               | The [function mapping progress to flight stages and positions](../../packages/client/src/FlightPathField.tsx).                                                                                                    | The plane and scenery. Clouds, runway motion, and turbulence live in CSS.                                                        |
| Telemetry Bloom, Release Transit, Status Weather, Radial, Runway, Orbit, and Signal Field | [Elapsed time, estimate, progress, and overdue state](../../packages/client/src/running-timing.ts).                                                                                                               | The effects are largely CSS. A moving packet fits a row of cells. Gradients and layers need simpler treatments or raster output. |

All ten treatments can share what progress means. Two already have reusable simulations and one has reusable flight choreography. A browser can draw a shape smoothly while the terminal snaps it to cells, and both can still agree about when it lands. That distinction between scene behavior and drawing accounts for most of the reuse available in the current code.
