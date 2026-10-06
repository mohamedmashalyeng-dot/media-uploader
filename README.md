# ORVANN Assets

Private Media Library / Asset Manager for ORVANN website assets.

Includes upload, folders, metadata editing, copyable URLs/embed code, and Trash with restore or permanent delete.

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

For local image/video testing, you can skip external storage and use local media storage:

```env
STORAGE_DRIVER=local
LOCAL_MEDIA_DIR=uploads
LOCAL_MEDIA_PUBLIC_BASE_URL=/media
```

For production and the largest number of files, keep Neon for metadata and use Backblaze B2 for the actual images/videos:

```env
STORAGE_DRIVER=b2
B2_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_KEY_ID=your-key-id
B2_APPLICATION_KEY=your-application-key
B2_BUCKET_NAME=your-bucket
B2_PUBLIC_BASE_URL=https://media.kentbusinesscollege.com
```

In local mode, images and videos are accepted. In B2/S3 mode, images, videos, documents, and large direct browser uploads are supported.

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
BACKBLAZE_B2_SETUP.md
```

Large videos and files above 15 MB upload directly from the browser to object storage through presigned URLs, which keeps Hostinger shared hosting memory usage low.

## Object Storage

For local image/video uploads, use `STORAGE_DRIVER=local`.

For documents, very large videos, and long-term scalable storage, use any S3-compatible provider. Backblaze B2 is the recommended low-cost option for this project.

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

The same Backblaze configuration can also use the clearer aliases:

```env
STORAGE_DRIVER=b2
B2_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_KEY_ID=your-key-id
B2_APPLICATION_KEY=your-application-key
B2_BUCKET_NAME=your-bucket
B2_PUBLIC_BASE_URL=https://media.kentbusinesscollege.com
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
