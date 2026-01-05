<div align="center">
    <p><img src="public/favorite-atv.png" width="300px"><br />
    <h1>DMM Cast WebDAV</h1>
</div>


DMM Cast WebDAV makes it quick and easy to stream media cast from [Debrid Media Manager]:

* **without** Stremio add-ons; and
* with support for [Infuse] and other media players that can stream from **`WebDAV`** and **`.strm`** files.

## Features

**DMM Cast Streaming**: stream media cast with [DMM Cast] **without** using the Stremio add-on

**Delete via WebDAV**: remove media from DMM Cast directly from [Infuse] and other media players

**Favorites Artwork**: default and customizable [artwork for favorites](https://support.firecore.com/hc/en-us/articles/4405042929559-Overriding-Artwork-and-Metadata) in Infuse

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andesco/dmm-cast-webdav)
      
1. Workers → Create an application → [Clone a repository](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/deploy-to-workers): <nobr>Git repository URL:</nobr>
   ```
   https://github.com/andesco/dmm-cast-webdav
   ```

2. **Optional: Enable Single-User Mode**\
[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/) → {worker name} → Settings: <nobr>Variables and Secrets:</nobr>

   `RD_ACCESS_TOKEN` · https://real-debrid.com/apitoken \
   `WEBDAV_USERNAME` \
   `WEBDAV_PASSWORD`
   

3. Verify that your DMM Cast media is accessible:
   ```
   https://dmm-cast-webdav.{user}.workers.dev
   ```
4. Add the WebDAV endpoint to Infuse or other supported media player.

## Usage

### Default: Multi-User Mode • [dmmcast.stream]

Any user can authenticate with their own Real-Debrid API token. No configuration is required.

  - WebDAV URL: `https://{hostname}/`
  - username: `apitoken`
  - password: `[your API token]`

### Optional: Single-User Mode
A single user can authenticates with custom credentials. Cloudflare Secrets are all required.

  - WebDAV URL: `https://{hostname}/`
  - username: `{WEBDAV_USERNAME}`
  - password: `{WEBDAV_PASSWORD}`

### Stream Media

WebDAV directories and file lists are refreshed each time you access the service, with `.strm` files created for each direct download link.

### Add Media

Cast media using [Debrid Media Manager]:

- cast: <code>[debridmediamanager.com](https://debridmediamanager.com)</code>
- manage casted links: <code>[debridmediamanager.com/stremio/manage](https://debridmediamanager.com/stremio/manage)</code>

### Delete Media

All `.strm` files include `hash` and `imdb` metadata in the filename. These additions allow you to remove media from DMM Cast when you delete the associated `.strm` file within [Infuse] (or other media players that support file management).

> [!TIP]
> Allow remote videos to be deleted in your media player: \
> Infuse → Settings → File Management: On



### Media Player Artwork

Infuse and other media players that support [overriding artwork](https://support.firecore.com/hc/en-us/articles/4405042929559-Overriding-Artwork-and-Metadata) can use the [artwork] served via WebDAV. Infuse defaults to using `favorite.png` and `favorite-atv.png`.

<div align="center">
    <p><img src="public/favorite-atv.png" width="300px"><br />
    DMM Cast
</div>


## Configuration

### Optional Environment Variables

Configuration is optional and handled through environment variables (Secrets)

Use `npx wrangler secret put {VARIABLE_NAME}` to set secrets.

Secret | Description |
-------|-------------|
`RD_ACCESS_TOKEN` | your Real-Debrid API access token
`WEBDAV_PASSWORD` | password for basic auth
`WEBDAV_USERNAME` | username for basic auth

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

## Troubleshooting

### Health Check Endpoint

The `/health` endpoint is available for monitoring and does not require authentication:
```
http://{hostname}/health
```
```json
{
  "status": "ok",
  "uptime": 0,
  "timestamp": "2025-12-18T06:00:00.000Z"
}
```

### Common Issues

**Authentication fails:**
- verify `WEBDAV_USERNAME` and `WEBDAV_PASSWORD` are set correctly
- verify `RD_ACCESS_TOKEN` is set correctly
- check the credentials used by your media player

**Cloudflare Worker deployment fails:**
- verify `account_id` is correct if using `wrangler.local.toml`

**No media appears in WebDAV:**
- verify you have cast media in [DMM Cast]
- check that `RD_ACCESS_TOKEN` or your Real-Debrid API token is valid
- review Cloudflare Worker service logs: `npm run tail`

[Hono]: http://hono.dev
[Infuse]: https://firecore.com/infuse
[strm]: https://support.firecore.com/hc/en-us/articles/30038115451799-STRM-Files
[Debrid Media Manager]: https://debridmediamanager.com
[dmm]: http://debridmediamanager.com
[DMM]: https://debridmediamanager.com
[DMM Cast]: https://debridmediamanager.com/stremio/manage
[dmmcast.stream]: https://dmmcast.stream
[Stremio add-on]: https://debridmediamanager.com/stremio
[Real-Debrid]: https://real-debrid.com
[artwork]: https://github.com/andesco/dmm-cast-webdav/tree/main/public
