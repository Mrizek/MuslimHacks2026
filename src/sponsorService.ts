export interface UploadService {
  upload(file: File): Promise<string>
}

// Hosted URLs are the working local path; a backend upload adapter can replace this interface later.
export const uploadService: UploadService | null = null