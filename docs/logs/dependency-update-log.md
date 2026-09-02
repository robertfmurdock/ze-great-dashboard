# Automated npm dependency updates

Recorded 2026-09-02.

The repository now uses `npm-check-updates` as a pinned development tool to update direct npm
dependencies. Pinning makes the automated manifest-editing behavior reviewable and repeatable; it
does add one development dependency and its transitive supply-chain surface, justified by replacing
an error-prone manual multi-workspace update process.

The updater includes the root package and every npm workspace. A workspace is a release-relevant
part of the product even where it is not published independently, so leaving one behind would make
the automation a partial confidence claim. It regenerates the lockfile with lifecycle scripts
disabled.

The automation creates a pull request and requests rebase auto-merge rather than merging itself.
The normal Build workflow and protected-branch requirements remain the release-confidence boundary;
there is no dependency-specific passing shortcut. A regression exposed by an update should add the
smallest meaningful test through the affected real interface, preserving evidence for the same
failure class without duplicating structural coverage.

GitHub Actions and Docker base-image updates are intentionally excluded. They alter CI privileges
or runtime-image provenance and deserve a deliberate human review rather than npm's package update
mechanism.

Clarification, 2026-09-02: focused checks are encouraged during implementation to shorten the
feedback loop, but every commit still runs the unified `npm run check` gate. That preserves broad
release evidence without making every small iteration pay for unrelated interfaces. The updater now
also fails if it changes anything outside the root/workspace manifests and lockfile, rather than
silently leaving an unexpected modification unstaged. Updating the pinned npm toolchain is deferred
until its relationship to the Node 24/npm 11.19.0 CI contract receives a separate review.

The permitted-update set is derived from the root `workspaces` declaration by one repository script.
The workflow invokes that script before staging all changes, avoiding a second workflow-specific
allowlist that could silently drift as workspaces change.

After the first manual runs, auto-merge was enabled and `main` gained its required **Build and
check** branch-protection gate. The workflow now also removes its pushed update branch if PR creation
fails, while preserving a branch once its PR exists for normal CI and recovery.
