# Day-1 spike results

Fill in as the checks run. `scripts/spike/brain-checks.ts` automates most of them.

| # | Check (spec §8) | Result | Notes / fallback chosen |
|---|---|---|---|
| 1 | Restore via API from another Sprite | | |
| 2 | Custom API connector → api.sprites.dev | | provider slug: |
| 3 | GitHub connector: tarball + Git Data API | | |
| 4 | Claude long-lived token survives restore | | |
| 5 | Pinecone via gateway (integrated index) | | PINECONE_PATH_PREFIX: |
| 6 | Public URL + webhook cold wake < 10 s | | cold wake: |
| 6b | Open exec keeps brain awake? | | KEEP_AWAKE=tasks needed? |
| 7 | Ollama Cloud connector (optional) | | |
| 8 | Cost after one full job | | |

## Connection ids

- GitHub (bot): 
- Pinecone: 
- Custom API (Sprites): 
