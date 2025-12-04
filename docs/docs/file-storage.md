---
sidebar_position: 9
title: File Storage & Attachments
---

# File Storage & Attachments

TestPlanIt supports file attachments across test cases, test runs, sessions, and other entities. The system supports both AWS S3 and MinIO (S3-compatible) storage backends for secure, scalable file management.

## Overview

The file storage system provides:

- **Secure file uploads** with signed URL generation
- **Multiple storage backends** (AWS S3, MinIO)
- **File type validation** and size limits
- **Attachment management** across all entities
- **Access control** based on user permissions

## Supported File Types

TestPlanIt accepts a wide variety of file types:

- **Images**: PNG, JPG, JPEG, GIF, WebP, SVG
- **Documents**: PDF, DOC, DOCX, TXT, RTF
- **Spreadsheets**: XLS, XLSX, CSV
- **Presentations**: PPT, PPTX
- **Archives**: ZIP, RAR, 7Z
- **Code**: JS, TS, JSON, XML, HTML, CSS
- **Other**: Log files, configuration files, and more

## Storage Configuration

### AWS S3 Setup

Configure AWS S3 in your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-bucket-name

# Optional: Custom S3 endpoint (for S3-compatible services)
# AWS_S3_ENDPOINT=https://your-s3-endpoint.com
```

#### Required AWS Permissions

Your AWS user needs the following S3 permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectVersion",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name"
    }
  ]
}
```

### MinIO Setup

TestPlanIt supports MinIO as an S3-compatible alternative:

```env
# MinIO Configuration
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=testplanit
AWS_S3_ENDPOINT=http://localhost:9000
```

#### Docker Compose MinIO Setup

Add MinIO to your Docker setup:

```yaml
version: '3.8'
services:
  minio:
    image: minio/minio:latest
    container_name: testplanit-minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  minio_data:
```

#### MinIO Bucket Creation

Create the required bucket:

1. Access MinIO console at `http://localhost:9001`
2. Login with your credentials
3. Create a bucket named `testplanit` (or your configured bucket name)
4. Set bucket policy to allow read/write access

## File Upload Process

### User Interface

Users can attach files in several ways:

1. **Drag and Drop**: Drag files directly onto attachment areas
2. **File Browser**: Click "Choose Files" to open file picker
3. **Rich Text Editor**: Paste images directly into rich text fields
4. **Bulk Upload**: Select multiple files at once

### Storage Modes

TestPlanIt supports two upload modes depending on your deployment:

#### Direct Mode (Default)

Used when S3/MinIO is publicly accessible from the browser:

1. Frontend requests a presigned URL from the API
2. Browser uploads directly to S3/MinIO using the presigned URL
3. No file data passes through the Next.js server

This is the most efficient mode as files upload directly to storage.

#### Proxy Mode

Used for hosted instances where MinIO is not publicly accessible:

1. Browser sends file to a Next.js server action
2. Server action uploads the file to S3/MinIO
3. Server returns the stored file URL

Set proxy mode by configuring `STORAGE_MODE=proxy` in your environment.

:::info Technical Note
Proxy mode uses Next.js Server Actions instead of Route Handlers. This is because Next.js App Router Route Handlers have a hardcoded 1MB body size limit that cannot be configured. Server Actions support configurable body size limits via `experimental.serverActions.bodySizeLimit` in `next.config.mjs`.
:::

### Upload Flow

1. **File Selection**: User selects or drops files
2. **Validation**: System checks file type and size limits
3. **Mode Detection**: System determines direct vs proxy mode
4. **Upload**:
   - *Direct mode*: Frontend requests presigned URL, uploads directly to S3/MinIO
   - *Proxy mode*: Frontend calls server action, which uploads to S3/MinIO
5. **Metadata Storage**: File information stored in database
6. **Attachment Link**: File linked to parent entity

### File Size Limits

Default limits (configurable):

- **Maximum file size**: 100MB per file
- **Total attachments**: No limit per entity
- **Concurrent uploads**: 5 files maximum

## Attachment Management

### Viewing Attachments

Attachments appear in several locations:

- **Test Case Details**: View all case attachments
- **Test Run Results**: See evidence and screenshots
- **Session Results**: View session documentation
- **Rich Text Content**: Inline images and documents

### Download and Access

- **Direct Download**: Click attachment name to download
- **Preview**: Supported file types show inline preview
- **Secure Access**: All downloads use signed URLs with expiration
- **Permission Checks**: Access based on entity permissions

### Deleting Attachments

Users with appropriate permissions can:

1. Click the delete (×) button next to attachment
2. Confirm deletion in dialog
3. File removed from both storage and database

:::warning
Deleted attachments cannot be recovered. Ensure you have backups if needed.
:::

## Security Features

### Access Control

- **Permission-Based**: Access follows entity permissions
- **Signed URLs**: All file access uses temporary signed URLs
- **Expiration**: Download links expire after 1 hour
- **Authentication**: Requires valid user session

### File Validation

- **Type Checking**: MIME type validation on upload
- **Size Limits**: Configurable maximum file sizes
- **Malware Scanning**: Optional virus scanning integration
- **Content Filtering**: Blocks potentially harmful file types

## API Reference

### Get Upload URL

```http
POST /api/get-attachment-url
Content-Type: application/json

{
  "fileName": "screenshot.png",
  "fileSize": 1024000,
  "contentType": "image/png"
}
```

Response:

```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket/file?signature=...",
  "fileKey": "attachments/uuid/screenshot.png"
}
```

### File Downloads

Files are accessed directly through signed URLs generated during upload. The system does not provide a separate download API endpoint - instead, files are downloaded directly from S3/MinIO using the signed URLs provided during the upload process.

**Direct Download:**

- Files are accessed via signed URLs from S3/MinIO
- URLs are generated with appropriate expiration times
- Access is controlled through the original upload permissions

## Troubleshooting

### Upload Failures

**Issue**: Files fail to upload
**Solutions**:

- Check file size against limits
- Verify file type is supported
- Ensure storage backend is accessible
- Check network connectivity

### Access Denied Errors

**Issue**: Cannot download attachments
**Solutions**:

- Verify user has access to parent entity
- Check if attachment still exists in storage
- Ensure storage credentials are valid
- Review bucket permissions

### Storage Configuration

**Issue**: Storage backend not working
**Solutions**:

- Verify environment variables are set
- Test S3/MinIO connectivity
- Check bucket exists and is accessible
- Review AWS/MinIO credentials

### Performance Issues

**Issue**: Slow upload/download speeds
**Solutions**:

- Check network bandwidth
- Consider using CDN for downloads
- Optimize file sizes before upload
- Monitor storage backend performance

## Best Practices

### For Users

1. **File Organization**: Use descriptive file names
2. **Size Optimization**: Compress large images before upload
3. **File Types**: Use appropriate formats for content
4. **Security**: Don't upload sensitive information

### For Administrators

1. **Storage Monitoring**: Monitor storage usage and costs
2. **Backup Strategy**: Implement regular backups
3. **Access Policies**: Review and update bucket policies
4. **Performance**: Monitor upload/download metrics
5. **Security**: Regular security audits of storage access

## Advanced Configuration

### Custom Storage Backends

TestPlanIt can be extended to support additional storage backends by implementing the storage interface.

### CDN Integration

For better performance, configure CloudFront or similar CDN:

```env
# CDN Configuration
AWS_CLOUDFRONT_DOMAIN=d123456789.cloudfront.net
AWS_CLOUDFRONT_DISTRIBUTION_ID=E123456789ABCD
```

### Backup and Archival

Consider implementing:

- **Automated backups** of attachment storage
- **Lifecycle policies** for old attachments
- **Cross-region replication** for disaster recovery
- **Archive storage** for infrequently accessed files