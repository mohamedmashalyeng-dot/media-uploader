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
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=https://media.kentbusinesscollege.com
```

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

Large videos and files above 15 MB upload directly from the browser to Cloudflare R2 through presigned URLs, which keeps Hostinger shared hosting memory usage low.

## Cloudflare R2

Create an R2 bucket, generate S3-compatible API credentials, connect the custom domain `media.kentbusinesscollege.com`, and configure CORS to allow authenticated browser uploads from your dashboard origin.

Suggested R2 CORS rule:

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
