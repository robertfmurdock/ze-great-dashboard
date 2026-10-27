# Client boundary refactoring log

## 2026-10-27 — keep dashboard composition evidence small and test owners directly

`App.test.tsx` had become a broad integration suite: it directly rendered configuration errors and
security details, reproduced panel presentation states, owned polling lifecycle assertions, and
opened the layout-warning dialog. That made a failure expensive to localize and obscured the small
set of contracts that actually belong to dashboard composition.

The refactor keeps App-level evidence for wiring a loaded board through panel selection and the
security deployment boundary. Detailed rendering and interaction contracts now live with their
owners: `ConfigError`, `SecurityDetails`, `HttpValuePanel`, `LayoutWarning`, and board loading.
The shared client test fixture preserves the old Strict Mode, pending-fetch, storage isolation, and
Testmints resource cleanup behavior as the tests move between files.

Board loading became `useBoardConfig`. It owns request cancellation, parsing-versus-transport
diagnostic classification, safe empty-board fallback, and the compact board summary. `Dashboard`
remains the composition boundary joining that hook to client-update checks, panel polling, layout,
attention, diagnostics, and the footer. `LayoutWarning` became a component because it independently
owns disclosure state, Escape handling, and authenticated layout downloads.

This does not claim that composition tests are unnecessary: a small integrated test is retained
where it proves that the board’s configured panel types select and request the correct real client
interfaces. More detailed behavior should normally be added at the component or hook boundary; a
new cross-boundary test needs a specific subtle interaction to justify it.

The unified `npm run check` gate passed after the refactor.
