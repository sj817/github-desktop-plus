# Application artwork

The approved icon is the purple Octocat with a white sparkle joined to the upper-right arc. Its master image and generation prompt are in [docs/design/icon-plus](../../../docs/design/icon-plus/README.md).

Run `pwsh -File scripts/prepare-icons.ps1` from the repository root to regenerate:

- `gdp-icon.png`: 1024 px application artwork.
- `gdp.ico`: Windows icon with 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 px frames.
- `installer-splash.png`: transparent 900 x 600 installer splash.
- `apps/site/logo.png`: 256 px website logo and favicon.

The executable, installer and runtime window icon all use the same `gdp.ico`. The PNG master replaces the previous SVG artwork.
