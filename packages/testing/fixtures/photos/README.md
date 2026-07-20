# Synthetic photo fixtures

These PNG files contain only programmatically drawn geometric shapes. They are not photographs of real homes, people, or listings and contain no personal information.

Generate them deterministically with:

```bash
pnpm --filter @vera/testing generate:photo-fixtures
```

`synthetic-building-base.png` and `synthetic-building-transformed.png` represent the same synthetic visual after a resize/re-encode. `synthetic-building-different.png` is a deliberately different drawing. Product code receives their bytes from tests or the future closed fixture registry; the scoring package never fetches an image URL.
