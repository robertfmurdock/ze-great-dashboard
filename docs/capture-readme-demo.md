# README preview capture

## Static panel-state gallery

`docs/assets/readme-panel-states.png` is a checked-in 1440 × 900 screenshot of the
`readme-panel-states` board. It shows passed, running, failed, cancelled, unknown, and source-error
states using deterministic fixture envelopes. The board and fixtures contain no credentials, and
the Playwright capture intercepts every board and panel API response, so no GitHub or other live
authority is contacted.

Regenerate it with:

```sh
npm run capture:readme:states
```

The command uses the normal Vite and application-server development path, disables motion, writes
`docs/assets/readme-panel-states.png`, checks that all six labels rendered, and cleans up its local
server processes. Inspect it with:

```sh
file docs/assets/readme-panel-states.png
```

The animated preview workflow follows below.

`docs/assets/readme-demo.gif` is a checked-in visual preview of the dashboard's animated pipeline
treatments. It is generated from the source-free `animation-showcase` board in
`boards/animation-showcase.yaml`, so it does not call GitHub, use credentials, or depend on live
engineering data. The board holds each treatment explicitly, including the stable
`signal-field` and `falling-shapes` panels; the status glyphs and “Running” labels remain visible.

The capture settings are deliberately fixed:

- Browser viewport: 1440 × 900 CSS pixels, device scale factor 1, animations enabled.
- Duration and cadence: 6 seconds at 10 frames per second, beginning 750 ms after the first field
  appears.
- Output: 960 × 600 pixels, looping GIF, 128-color difference palette, Lanczos scaling.
- Local ports: Vite on 5174 and the application server on 3001, so an existing `npm run dev` on
  the usual 5173/3000 ports is not disturbed.

The current output is approximately 1.1 MB. If visual changes make the asset substantially larger,
reduce the capture duration or palette/colors in `scripts/capture-readme-demo.mjs` and re-check that
the status text and glyphs are still legible.

Requirements: Node.js 22+, installed npm dependencies, a local Playwright browser, and `ffmpeg`.
No npm dependency is added for GIF encoding.

## Regenerate locally

Requirements: Node.js 22+, installed npm dependencies, a locally installed Playwright browser, and
`ffmpeg` on `PATH`. Install the repository dependencies first if needed:

```sh
npm install
```

Then regenerate the asset after an intentional visual change:

```sh
npm run capture:readme
```

The command starts separate Vite and application-server processes through the real development
path, waits for `/health`, loads the showcase, captures viewport frames with Playwright, writes
`docs/assets/readme-demo.gif`, and removes its temporary frame directory. It also cleans up both
local server processes when capture finishes. The capture is treatment-stable, though the exact
animation phase can differ between runs because the treatments are live CSS/clock animations.

Inspect the generated asset before committing:

```sh
file docs/assets/readme-demo.gif
du -h docs/assets/readme-demo.gif
```

To review a frame without opening the GIF, extract one with `ffmpeg` and inspect it in an image
viewer:

```sh
ffmpeg -y -i docs/assets/readme-demo.gif -frames:v 1 /tmp/readme-demo-frame.png
```

If capture fails with a port error, check that 5174 and 3001 are free. If Chromium is blocked by
the host sandbox, run the command in the normal local desktop environment where Playwright is
permitted to launch its installed browser.

The temporary `scripts/readme-demo-frames/` directory is intentionally not an artifact and should
not be committed.

## Public demo handoff

The README image is linked to `README_DEMO_URL` until an administrator supplies a real public URL.
Before changing it, deploy an anonymous, read-only instance using this same source-free board.
The repository's AWS application template deliberately creates no public endpoint: follow
`docs/aws-setup.md` to package and deploy the server, configure a consumer-owned public gateway
with no credentials, and use the generated `AssetPath` for the matching immutable client.

Verify the handoff before editing the README link:

1. `GET /health` succeeds through the public URL.
2. The dashboard opens anonymously and renders the `animation-showcase` board.
3. The browser-visible configuration contains no secrets or private URLs.
4. The hosted client asset path matches the deployed server's `AssetPath`.

Replace only the link target in `README.md`, leaving the GIF path unchanged:

```md
[![Animated Ze Great Dashboard preview](docs/assets/readme-demo.gif)](https://example.your-approved-demo-host/)
```
