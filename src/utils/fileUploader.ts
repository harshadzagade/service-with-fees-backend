import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const isS3Configured = () => {
  return (
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
};

let s3Client: S3Client | null = null;
if (isS3Configured()) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
}

export interface PresignedUrlResponse {
  uploadUrl: string; // The URL to PUT the file data to
  fileUrl: string;   // The final public or read URL of the file
  isMock: boolean;
}

export async function getPresignedUploadUrl(
  fileName: string,
  fileType: string
): Promise<PresignedUrlResponse> {
  const uniqueFileName = `${Date.now()}_${fileName.replace(/\s+/g, '_')}`;

  if (s3Client && process.env.AWS_S3_BUCKET) {
    console.log(`Generating AWS S3 pre-signed upload URL for ${uniqueFileName}...`);
    try {
      const bucketName = process.env.AWS_S3_BUCKET;
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: uniqueFileName,
        ContentType: fileType,
      });

      // URL expires in 15 minutes (900 seconds)
      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
      const region = process.env.AWS_REGION || 'ap-south-1';
      const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${uniqueFileName}`;

      return {
        uploadUrl,
        fileUrl,
        isMock: false,
      };
    } catch (error) {
      console.error('Failed to generate S3 pre-signed URL. Falling back to local upload.', error);
    }
  }

  // Local/Mock Fallback
  console.log(`Generating local mock pre-signed upload URL for ${uniqueFileName}...`);
  const port = process.env.PORT || 5000;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  // This directs PUT requests to our local mock endpoint
  const uploadUrl = `${baseUrl}/api/public/upload-local?fileName=${uniqueFileName}&fileType=${encodeURIComponent(fileType)}`;
  // This is the static URL to access the uploaded file
  const fileUrl = `${baseUrl}/uploads/${uniqueFileName}`;

  return {
    uploadUrl,
    fileUrl,
    isMock: true,
  };
}
