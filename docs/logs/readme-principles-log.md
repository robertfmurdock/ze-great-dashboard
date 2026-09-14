# README principles, not an inventory — 2026-09-14

A review of the top-level README found that an otherwise accurate list of integrations and panel
types made the project sound like a catalog. That is the least durable and least important part of
its introduction: individual sources, panel forms, and presentation treatments will evolve, while
the reason to trust the dashboard should remain recognizable.

The README should therefore establish four commitments before it directs a prospective user to
setup or the feature tour:

- **Evidence over assertion:** the dashboard is a lens onto named authorities. Observation time,
  source links, and explicit unreadable or stale states keep it from claiming more certainty than
  the underlying systems provide.
- **Ownership over extraction:** it is self-hosted, does not become a data warehouse, and keeps
  credentials in the operator-controlled runtime boundary. Authentication and public exposure are
  deliberate security decisions, not an incidental default.
- **Legibility over decoration:** accessible labels, glyphs, contrast, and reduced-motion behavior
  are part of the evidence contract. A status that only some viewers can interpret is not an honest
  shared status.
- **Value without lock-in:** MIT licensing means no software price, hosted-service charge, or
  per-seat fee. Operating-cost measurements help an evaluator judge the real infrastructure cost,
  but are examples with stated assumptions, never a universal price promise.

Concrete capabilities still need documentation, screenshots, and measured deployment evidence; the
feature tour and operating guides are their appropriate home. The README's role is to answer what
the dashboard is, why scattered engineering status needs it, and what its trust, accessibility, and
cost commitments mean before a reader encounters a changing support matrix.

These principles are also recorded in the living implementation status because they should guide
future product work, not merely this wording pass. The historical `original-pitch.md` remains
unchanged so that its initial reasoning can continue to be compared with the implemented project.
