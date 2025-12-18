# AI Agent Instructions

## Project Overview

**DMM Cast WebDAV** is a WebDAV streaming service for Debrid Media Manager Cast links. Built on [Hono](http://hono.dev) to run as a Cloudflare Workers serverless function.

## Core Features

1. **DMM Cast Streaming**: Stream media cast with DMM Cast via WebDAV
2. **Delete via WebDAV**: Remove media from DMM Cast by deleting .strm files
3. **Media Player Artwork**: Serve PNG artwork files alongside .strm files

## WebDAV Endpoint

- `/` (root) - All DMM Cast .strm files and PNG artwork files

## Key Technologies

- **Framework**: Hono (Cloudflare Workers)
- **Deployment**: Cloudflare Workers only
- **Auth**: Basic Auth for WebDAV
- **Assets**: Bundled PNG files from public directory

## Important Files

- `src/app.js` - Main application logic
- `src/config.worker.js` - Cloudflare Workers configuration
- `src/dynamic-assets.js` - Asset serving (PNG files)
- `src/html.js` - HTML templates
- `public/*.png` - Artwork files served via WebDAV

## Build/Deploy Commands

- **Dev server**: `npm run dev`
- **Build assets**: `npm run build`
- **Deploy**: `npm run deploy`
- **Tail logs**: `npm run tail`

## Code Style Guidelines

### Imports & Naming
- ES6 imports with relative paths, include `.js` extension: `import { foo } from './foo.js'`
- Functions/variables: camelCase (`getCastedLinks`, `getDMMCastWebDAVFiles`)
- Constants: UPPER_SNAKE_CASE (`RD_ACCESS_TOKEN`)
- Files: camelCase with `.js` extension

### Formatting & Structure
- 4-space indentation, single quotes, async/await preferred
- JSDoc comments for exported functions
- `const` for immutable values, `let` for mutable
- Arrow functions for callbacks, early returns

### Error Handling & Security
- Throw descriptive `Error` objects with console logging
- Never log sensitive data (tokens, passwords)
- Validate environment variables before use
- Use Proxy pattern for universal environment access (see `src/env.js`)

## Development Notes

- All WebDAV content served at root `/` (no subdirectories)
- PNG files from `public/` directory included in WebDAV listing
- .strm files contain direct URLs from DMM Cast API
- Delete functionality parses hash and imdbId from .strm filenames