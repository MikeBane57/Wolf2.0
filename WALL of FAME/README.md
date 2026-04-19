# Wall of Fame (shared data)

Single file **`wall-of-fame.json`** in this folder holds all accolades for the **SOD Wall of Fame** userscript.

Shape:

```json
{
  "entries": [
    {
      "id": "unique-id",
      "title": "Accolade title",
      "holder": "Name",
      "note": "",
      "sortOrder": 1,
      "updatedAt": 0
    }
  ],
  "updatedAt": 0
}
```

The userscript does **not** embed default accolades; it loads from this path (or your configured `wallOfFameRepoPath`) after sync, and caches in **localStorage** for offline display.

See **`ACTIONS_SYNC.md`** for GitHub Actions + team key setup.
