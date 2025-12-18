# DMM Cast WebDAV

Stream media from [Debrid Media Manager Cast][DMM Cast] via WebDAV.

DMM Cast WebDAV provides a WebDAV interface for media cast with [DMM Cast], making it compatible with [Infuse] and other media players that support **`WebDAV`** and **`.strm`** files.

Built on [Hono] to run as a Cloudflare Workers serverless function.

## Features

**DMM Cast Streaming**: Stream media cast with [DMM Cast] directly via WebDAV, without using the Stremio add-on.

**Delete via WebDAV**: Remove media from DMM Cast directly from [Infuse] and supported media players by deleting `.strm` files.

**Media Player Artwork**: Infuse and other media players that support [overriding artwork](https://support.firecore.com/hc/en-us/articles/4405042929559-Overriding-Artwork-and-Metadata) can use the [artwork] served via WebDAV.

<div align="center">
    <p><img src="public/dmmcast/favorite-atv.png" width="300px"><br />
    DMM Cast
</div>

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andesco/dmm-cast-webdav)
      
1. Workers → Create an application → [Clone a repository](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers): <nobr>Git repository URL:</nobr>
   ```
   https://github.com/andesco/dmm-cast-webdav
   ```

2. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/) ⇢ {worker name} ⇢ Settings: <nobr>Variables and Secrets:</nobr>

   **Required Secrets**:\
   `RD_ACCESS_TOKEN` · https://real-debrid.com/apitoken \
   `WEBDAV_USERNAME` \
   `WEBDAV_PASSWORD`
   
   Optional Text Variables:\
   `PUBLIC_URL`
   

3. Verify your DMM Cast media is accessible:
   ```
   https://dmm-cast-webdav.{user}.workers.dev
   ```

4. Add the WebDAV endpoint to your media player:
   ```
   https://dmm-cast-webdav.{user}.workers.dev/dmmcast/
   ```

## Usage

### Adding Media

Cast media using [Debrid Media Manager][DMM Cast]:

- cast: <code>[debridmediamanager.com](https://debridmediamanager.com)</code>
- manage casted links: <code>[debridmediamanager.com/stremio/manage](https://debridmediamanager.com/stremio/manage)</code>

### WebDAV

Add the WebDAV endpoint to your media player:

- URL: `https://{hostname}/dmmcast/`
  - all DMM Cast media added within the last 7 days
- username: `WEBDAV_USERNAME`
- password: `WEBDAV_PASSWORD`

WebDAV directories and file lists are refreshed each time you access the service, with `.strm` files created for each link.

> [!TIP]
> **Delete via WebDAV**: DMM Cast `.strm` filenames include `hash` and `imdb` metadata. These additions allow you to remove media from DMM Cast directly from [Infuse] and supported media players by deleting the file from within the app.

### Media Player Artwork

Infuse and other media players that support [overriding artwork](https://support.firecore.com/hc/en-us/articles/4405042929559-Overriding-Artwork-and-Metadata) can use the [artwork] served via WebDAV. Infuse defaults to using `favorite.png` and `favorite-atv.png`.

<div align="center">
    <p><img src="public/dmmcast/dmmcast-atv.png" width="300px"><br />
    DMM Cast
</div>

## Configuration

### Environment Variables

Configuration is handled through environment variables for Cloudflare Workers deployment.

Use `npx wrangler secret put {VARIABLE_NAME}` to set secrets.

| Variable | Description | Default |
|:---|:---|:---|
| `RD_ACCESS_TOKEN` | **required**: your Real-Debrid API access token | |
| `WEBDAV_PASSWORD` | **required**: password for basic auth | |
| `WEBDAV_USERNAME` | username for basic auth | `admin` |
| `PUBLIC_URL` | public-facing URL for `.strm` files; only required for custom domains behind reverse proxies |  |

## Deploy Using Wrangler CLI

```bash
gh repo clone andesco/dmm-cast-webdav
cd dmm-cast-webdav
npm install

wrangler secret put RD_ACCESS_TOKEN
wrangler secret put WEBDAV_USERNAME
wrangler secret put WEBDAV_PASSWORD

npm run deploy
```

## Health Check Endpoint

The `/health` endpoint is available for monitoring and does not require authentication:
```
http://your-worker-url/health
```
```json
{
  "status": "ok",
  "uptime": 0,
  "timestamp": "2025-12-18T06:00:00.000Z"
}
```

## Service Logs

Cloudflare Worker:
```bash
npm run tail
```

## Troubleshooting

### Common Issues

**Authentication fails:**
- verify `WEBDAV_USERNAME` and `WEBDAV_PASSWORD` are set correctly
- check the credentials used by your media player

**Cloudflare Worker deployment fails:**
- ensure secrets are set: `npx wrangler secret list`
- verify `account_id` is correct in `wrangler.local.toml`

**No media appears in WebDAV:**
- verify you have cast media in [DMM Cast] within the last 7 days
- check that `RD_ACCESS_TOKEN` is valid
- review worker logs: `npm run tail`

[Hono]: http://hono.dev
[Infuse]: https://firecore.com/infuse
[strm]: https://support.firecore.com/hc/en-us/articles/30038115451799-STRM-Files
[Debrid Media Manager]: https://debridmediamanager.com
[dmm]: http://debridmediamanager.com
[DMM]: https://debridmediamanager.com
[DMM Cast]: https://debridmediamanager.com/stremio/manage
[Stremio add-on]: https://debridmediamanager.com/stremio
[Real-Debrid]: https://real-debrid.com
[artwork]: https://github.com/andesco/dmm-cast-webdav/tree/main/public
