# README proof gallery

Implemented 2026-09-11.

The README gallery is deliberately evidence rather than a feature catalog: each still is tied to a
named, source-free fixture scenario and asserts the public wording it is meant to show before its
PNG is accepted. Status vocabulary is one complete frame rather than a scroll-dependent collection;
attention and security are separated because they answer different operational questions. The
existing GIF remains the one motion-specific artifact.

The capture runner uses the ordinary Vite/server path but intercepts every API response in the
browser, fixes time, asks for reduced motion, and aborts non-loopback requests. This keeps visual
evidence deterministic without adding a capture or image dependency. The blocked security scenario
starts from a tiny `security: required` board solely so the real server computes the fail-closed
browser boundary.

The repository gate passed after the implementation. This environment could not regenerate the
checked-in PNGs: native Chromium is denied its macOS rendezvous port by the execution sandbox, and
the Linux Playwright container cannot use the host's platform-specific Vite/esbuild dependency.
Run the documented capture commands in a normal local desktop checkout before committing the new
gallery assets; their assertions provide the intended release evidence.
