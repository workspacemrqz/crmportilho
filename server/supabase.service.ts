import fs from 'fs/promises';
import { mkdirSync, realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Local Storage Service
 * Manages file uploads and downloads from local filesystem
 * Replaces Supabase Storage with local file storage
 */
export class SupabaseStorageService {
  private uploadsDir: string;

  constructor() {
    // Set uploads directory to project root/uploads
    this.uploadsDir = path.join(__dirname, '..', 'uploads');
    
    // Ensure uploads directory exists synchronously to avoid race conditions
    this.ensureUploadsDirSync();
    
    console.log('[LocalStorage] Initialized with directory:', this.uploadsDir);
  }

  /**
   * Ensure uploads directory exists synchronously (called from constructor)
   * SECURITY: Using sync version to avoid race condition in constructor
   */
  private ensureUploadsDirSync(): void {
    try {
      mkdirSync(this.uploadsDir, { recursive: true });
    } catch (error) {
      console.error('[LocalStorage] Failed to create uploads directory:', error);
    }
  }

  /**
   * Validate leadId contains only alphanumeric characters
   * SECURITY: Strict validation to prevent directory traversal and Unicode homograph attacks
   * @param leadId - The leadId to validate
   * @returns Validated leadId (basename only)
   */
  private validateLeadId(leadId: string): string {
    if (!leadId || typeof leadId !== 'string') {
      throw new Error('Invalid leadId: must be a non-empty string');
    }

    // Only use basename to prevent path traversal
    const basename = path.basename(leadId);

    // Validate that it contains only alphanumeric characters (and optionally hyphens/underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(basename)) {
      throw new Error('Invalid leadId: must contain only alphanumeric characters, hyphens, and underscores');
    }

    return basename;
  }

  /**
   * Validate that a resolved path is within the uploads directory
   * SECURITY: Prevents directory traversal and symlink attacks by resolving symlinks and checking relative paths
   * @param targetPath - The path to validate
   */
  private validatePath(targetPath: string): void {
    try {
      // Resolve the uploads directory to its real path (following symlinks)
      const resolvedUploadsDir = realpathSync(this.uploadsDir);

      // Resolve the target path to its real path (following symlinks)
      // This will throw if the file/directory doesn't exist
      const resolvedTargetPath = realpathSync(targetPath);

      // Get the relative path from uploads directory to target
      const relativePath = path.relative(resolvedUploadsDir, resolvedTargetPath);

      // Check if the relative path starts with '..' (going up) or is absolute
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Invalid file path: Path traversal detected');
      }
    } catch (error: any) {
      // If realpathSync throws (e.g., path doesn't exist), rethrow with clearer message
      if (error.code === 'ENOENT') {
        throw new Error('Invalid file path: Path does not exist');
      }
      throw error;
    }
  }

  /**
   * Upload a file to local storage
   * @param file - File buffer
   * @param filename - Name of the file (original name, kept for metadata only)
   * @param leadId - Lead ID for organizing files
   * @param mimeType - MIME type of the file
   * @returns File path relative to uploads directory
   */
  async uploadDocument(
    file: Buffer,
    filename: string,
    leadId: string,
    mimeType: string
  ): Promise<string> {
    try {
      // SECURITY: Validate leadId to prevent directory traversal and Unicode homograph attacks
      const validatedLeadId = this.validateLeadId(leadId);

      // SECURITY: Generate UUID for filename to prevent Unicode homograph bypass
      // Original filename is preserved only in the basename for reference
      const fileId = crypto.randomUUID();
      const originalBasename = path.basename(filename);
      const filePath = `leads/${validatedLeadId}/${fileId}-${originalBasename}`;
      const fullPath = path.join(this.uploadsDir, filePath);

      console.log('[LocalStorage] Uploading file:', filePath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write file to disk
      await fs.writeFile(fullPath, file);

      // SECURITY: Validate that the created path is within uploads directory
      // This check happens after file creation to verify the actual path
      this.validatePath(fullPath);

      console.log('[LocalStorage] Upload successful:', filePath);

      // Return the file path (relative to uploads directory)
      return filePath;
    } catch (error) {
      console.error('[LocalStorage] Upload failed:', error);
      throw error;
    }
  }

  /**
   * Get a public URL for downloading a file
   * @param filePath - Path to the file in storage
   * @param expiresIn - Expiration time in seconds (not used for local storage, kept for compatibility)
   * @returns Public URL for downloading the file
   */
  async getSignedUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
    try {
      console.log('[LocalStorage] Getting public URL for:', filePath);

      const fullPath = path.join(this.uploadsDir, filePath);

      // SECURITY: Check if file exists before returning URL to prevent file enumeration
      try {
        await fs.access(fullPath);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          throw new Error('File not found');
        }
        throw error;
      }

      // SECURITY: Validate the file path and resolve symlinks
      this.validatePath(fullPath);

      // Get the domain from environment variable or construct it
      const domain = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : 'http://localhost:5000';

      // Return public URL accessible via /uploads endpoint
      const publicUrl = `${domain}/uploads/${filePath}`;
      
      console.log('[LocalStorage] Public URL created:', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error('[LocalStorage] Failed to get public URL:', error);
      throw error;
    }
  }

  /**
   * Download a file from local storage
   * @param filePath - Path to the file in storage
   * @returns File buffer
   */
  async downloadDocument(filePath: string): Promise<Buffer> {
    try {
      console.log('[LocalStorage] Downloading file:', filePath);

      const fullPath = path.join(this.uploadsDir, filePath);
      
      // SECURITY: Validate that the path is within uploads directory
      this.validatePath(fullPath);

      const buffer = await fs.readFile(fullPath);

      console.log('[LocalStorage] Download successful, size:', buffer.length);
      return buffer;
    } catch (error) {
      console.error('[LocalStorage] Download failed:', error);
      throw error;
    }
  }

  /**
   * Delete a file from local storage
   * @param filePath - Path to the file in storage
   */
  async deleteDocument(filePath: string): Promise<void> {
    try {
      console.log('[LocalStorage] Deleting file:', filePath);

      const fullPath = path.join(this.uploadsDir, filePath);
      
      // SECURITY: Validate that the path is within uploads directory
      this.validatePath(fullPath);

      await fs.unlink(fullPath);

      console.log('[LocalStorage] File deleted successfully');
    } catch (error) {
      console.error('[LocalStorage] Delete failed:', error);
      throw error;
    }
  }

  /**
   * List all files for a lead
   * @param leadId - Lead ID
   * @returns List of files
   */
  async listDocuments(leadId: string): Promise<any[]> {
    try {
      console.log('[LocalStorage] Listing documents for lead:', leadId);

      // SECURITY: Validate leadId to prevent directory traversal and Unicode homograph attacks
      const validatedLeadId = this.validateLeadId(leadId);
      const leadDir = path.join(this.uploadsDir, 'leads', validatedLeadId);
      
      try {
        const files = await fs.readdir(leadDir);
        
        // Get file stats for each file
        const fileDetails = await Promise.all(
          files.map(async (filename) => {
            const filePath = path.join(leadDir, filename);
            
            // SECURITY: Validate each file path and resolve symlinks
            this.validatePath(filePath);
            
            const stats = await fs.stat(filePath);
            
            return {
              name: filename,
              created_at: stats.birthtime,
              updated_at: stats.mtime,
              size: stats.size,
              path: `leads/${validatedLeadId}/${filename}`
            };
          })
        );

        // Sort by creation date (descending)
        fileDetails.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

        console.log('[LocalStorage] Found', fileDetails.length, 'documents');
        return fileDetails;
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, return empty array
          console.log('[LocalStorage] No documents found for lead:', leadId);
          return [];
        }
        throw error;
      }
    } catch (error) {
      console.error('[LocalStorage] List failed:', error);
      throw error;
    }
  }
}
