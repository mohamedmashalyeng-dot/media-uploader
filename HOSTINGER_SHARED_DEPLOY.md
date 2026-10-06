# Hostinger Shared Node.js Deployment

This project is designed to run on Hostinger shared Node.js hosting without a build step.

## Upload

Upload the project folder contents except:

```text
node_modules/
.env
```

Keep these files on the server:

```text
package.json
package-lock.json
server.js
app.js
styles.css
index.html
offline.html
sw.js
manifest.webmanifest
lib/
scripts/
sql/
```

## Hostinger Node.js Settings

In Hostinger / hPanel Node.js app setup:

```text
Node version: 18 or newer
Application root: folder where server.js exists
Application startup file: server.js
Start command: npm start
```

Hostinger usually provides `PORT` automatically. Leave `PORT` empty unless hPanel asks for it.

## Install Dependencies

Run in Hostinger terminal:

```bash
npm install --omit=dev
npm run hostinger:check
```

## Environment Variables

Use `hostinger.env.example` as the checklist.

Required:

```env
NODE_ENV=production
DATABASE_URL=
SESSION_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
S3_ENDPOINT=
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
S3_PUBLIC_BASE_URL=https://media.kentbusinesscollege.com
S3_FORCE_PATH_STYLE=false
```

For local images and videos, use local storage:

```env
STORAGE_DRIVER=local
LOCAL_MEDIA_DIR=uploads
LOCAL_MEDIA_PUBLIC_BASE_URL=/media
```

This stores uploaded images and videos in the app's `uploads/` folder and serves them from `/media/...`.

Shared hosting friendly media limits:

```env
MEDIA_BACKEND_UPLOAD_MAX_MB=100
MEDIA_MAX_IMAGE_MB=15
MEDIA_MAX_VIDEO_MB=100
MEDIA_MAX_DOCUMENT_MB=50
```

In local media mode, images and videos are accepted. Later, if you enable S3-compatible storage, the app sends videos and files larger than 15 MB directly from the browser to object storage using presigned URLs, so Hostinger does not need to buffer large files.

## Database Migration

Run once after adding `DATABASE_URL`:

```bash
npm run migrate
```

## Object Storage CORS

Use any S3-compatible provider, such as AWS S3, Backblaze B2, Wasabi, DigitalOcean Spaces, or Cloudflare R2.

Add your Hostinger app domain to the bucket CORS:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-HOSTINGER-DOMAIN"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Smoke Test

After starting/restarting the app:

```text
https://YOUR-HOSTINGER-DOMAIN/api/health
```

Expected:

```json
{"ok":true}
```

Then open:

```text
https://YOUR-HOSTINGER-DOMAIN/
```
