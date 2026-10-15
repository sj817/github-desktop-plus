# GitHub Desktop Plus icon

The approved design preserves the official Windows icon's purple circular Octocat mark and joins a white sparkle to its upper-right arc.

- [Approved master image](github-desktop-plus-v3.png)
- [Built-in imagegen edit prompt and provenance](v3.md)
- [Official production Windows icon](https://github.com/desktop/desktop/blob/development/app/static/logos/prod/icon-logo.ico), Git blob `fdc2624a329b824b503eaba6430ba4dba6beffe8`

`source/github-desktop-windows-256.png` is the unchanged PNG frame extracted from `source/github-desktop-official.ico` and used as the edit input.

Run `pwsh -File scripts/prepare-icons.ps1` to derive the application, installer and website assets from the approved image. This only resizes and packages the artwork.
