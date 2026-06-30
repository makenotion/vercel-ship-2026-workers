# Vercel Ship 2026 Workers

A CLI script for experimenting with Notion Workers-like tools.

## Setup

Install dependencies:

```bash
npm install
```

Create a Vercel project, then create a [Vercel Blob store and connect it to the
project](https://vercel.com/docs/vercel-blob#getting-started). Configure
[AI Gateway](https://vercel.com/docs/ai-gateway) for the same Vercel account.

Create a `.env` file with the credentials for those services:

```bash
AI_GATEWAY_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
```

The script also uses your local Vercel CLI authentication to create sandboxes,
so log in and link the repository to that project before running it.
