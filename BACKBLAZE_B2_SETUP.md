# Backblaze B2 Setup

Use this setup when you want Hostinger to run the app, Neon to store metadata, and Backblaze B2 to store the actual media files.

## 1. Create The Bucket

In Backblaze:

1. Create a B2 bucket.
2. Make it public, or connect a custom public domain.
3. Note the bucket region, for example `us-west-004`.

## 2. Create An Application Key

Create an application key with access to the bucket.

You need:

```env
B2_KEY_ID=
B2_APPLICATION_KEY=
B2_BUCKET_NAME=
```

## 3. Configure Environment Variables

On Hostinger, set:

```env
STORAGE_DRIVER=b2
B2_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_KEY_ID=your-key-id
B2_APPLICATION_KEY=your-application-key
B2_BUCKET_NAME=your-bucket-name
B2_PUBLIC_BASE_URL=https://media.your-domain.com
```

If you do not have a custom media domain yet, use the public bucket URL from Backblaze as `B2_PUBLIC_BASE_URL`.

## 4. Add Bucket CORS

Allow your app domain to upload directly from the browser:

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

## 5. Recommended Limits

```env
MEDIA_BACKEND_UPLOAD_MAX_MB=20
MEDIA_MAX_IMAGE_MB=15
MEDIA_MAX_VIDEO_MB=5000
MEDIA_MAX_DOCUMENT_MB=50
```

Videos are uploaded directly to B2 in S3 mode, so Hostinger does not need to hold the video file in memory.

The current uploader uses a single browser `PUT` upload. For individual videos larger than about 5 GB, add multipart upload support later.

