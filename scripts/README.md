# Scripts Inventory

This directory is intentionally split into two groups:

- Active script surfaces used by development, CI, release, and operations:
  - `_runtime`
  - `_fixtures`
  - `_support`
  - `checks`
  - `db`
  - `deploy`
  - `rebuild`
  - `release-gates`
  - `signoffs`
  - `smokes`
  - top-level `test-*` files

## Active directories

- `_runtime`: runtime helpers invoked by the application itself
- `_fixtures`: frozen test fixtures that keep active regression guards independent from old runtime archive paths
- `_support`: shared test and coverage infrastructure
- `checks`: health and operational checks
- `db`: migration/bootstrap/DB maintenance scripts
- `deploy`: operator-facing Docker platform helpers
  - write IP-only self-hosted production env files with generated secrets
  - one-command IP-only self-hosted Droplet launch
  - validate stack inputs and rendered compose
  - audit production env completeness and shared-secret consistency
  - one-command launch sequence
  - first-run bring-up
  - routine update
  - post-bootstrap rebuilds
  - live status, logs, stop, and restart helpers
  - public smoke checks
- `rebuild`: derived-data rebuild scripts
- `release-gates`: release gate entrypoints
- `signoffs`: signoff entrypoints
- `smokes`: smoke-test entrypoints
- top-level `test-*`: direct test entrypoints used by `package.json`
