# Vercel Ship 2026 Workers

A small Next.js app for experimenting with AI chat workflows, streamed responses, and persisted chat threads.

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file for local configuration:

```bash
AI_GATEWAY_API_KEY=your_api_key_here
# Optional; defaults to file:.data/chat.db
DATABASE_URL=file:.data/chat.db
# Optional; only needed for remote libSQL/Turso databases
DATABASE_AUTH_TOKEN=
```

Run the development server:

```bash
npm run dev
```
