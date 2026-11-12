# Popup company logo + country flag fix

## Issues
1. Popup showed a generic TrendingUp icon instead of the company logo from the catalogue.
2. Country flag emoji was cramped in a 40×40 box and looked too small.

## Changes
### `client/src/App.tsx`
- Reference popup asset header now renders `CompanyReferenceLogo` when `companyLogoUrl` / `companyDisplayName` is present.
- `CompanyReferenceLogo` accepts a `size` prop (72px on popup), resolves `/assets/...` paths, and falls back to initials if the image fails to load.

### `client/src/trading-experience.css`
- Logo container: 72px (56px on small screens), light background, contain fit.
- Flag: 56×42 desktop (font-size 34px), 64×48 mobile (font-size 42px), less clipping.

## Note
Logos load from paths like `/assets/company-logo-source/by-country/...` served from `client/public`. Ensure those static assets are deployed with the client build.
