# Media Uploader

Private Media Library / Asset Manager for website assets.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in:

```env
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

For local image/video storage on Hostinger shared hosting, you can skip external S3 storage and use local media storage:

```env
STORAGE_DRIVER=local
LOCAL_MEDIA_DIR=uploads
LOCAL_MEDIA_PUBLIC_BASE_URL=/media
```

In local mode, images and videos are accepted. Documents should use the S3-compatible mode later.

3. Apply the database migration:

```bash
npm run migrate
```

4. Start the app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Hostinger Shared Hosting

This app has no build step and is ready for Hostinger shared Node.js hosting.

Use:

```text
Startup file: server.js
Start command: npm start
Node.js: 18+
```

Before deployment, read:

```text
HOSTINGER_SHARED_DEPLOY.md
```

Large videos and files above 15 MB upload directly from the browser to object storage through presigned URLs, which keeps Hostinger shared hosting memory usage low.

## Object Storage

For local image/video uploads, use `STORAGE_DRIVER=local`.

For documents, very large videos, and long-term scalable storage, use any S3-compatible provider, such as AWS S3, Backblaze B2, Wasabi, DigitalOcean Spaces, or Cloudflare R2.

Backblaze B2 example:

```env
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_ACCESS_KEY_ID=your-key-id
S3_SECRET_ACCESS_KEY=your-application-key
S3_BUCKET_NAME=your-bucket
S3_PUBLIC_BASE_URL=https://media.kentbusinesscollege.com
S3_FORCE_PATH_STYLE=false
```

Configure the bucket/custom domain and add CORS to allow authenticated browser uploads from your dashboard origin.

Suggested CORS rule:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-DASHBOARD-DOMAIN"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Checks

```bash
npm run check
```
