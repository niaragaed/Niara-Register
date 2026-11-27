# Niara tab icons

Copy this whole folder to `public/icons/` in the Register and SME repos, plus `favicon.ico` to `public/favicon.ico`.

| File | Use |
|---|---|
| icon-dark-mark-16.png, icon-dark-mark-32.png | dark mark, transparent; light tab bars (`prefers-color-scheme: light`) |
| icon-light-mark-16.png, icon-light-mark-32.png | light mark, transparent; dark tab bars (`prefers-color-scheme: dark`) |
| apple-icon.png | 180x180, solid `#05070E` background, mark at ~78% |
| favicon.ico | 16, 32, 48 from the dark mark; for clients that request /favicon.ico |

Generated from `public/niara-mark.png` (never redrawn). Declared in `metadata.icons` in `src/app/layout.tsx`.
