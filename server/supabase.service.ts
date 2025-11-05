import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Extract Supabase URL from DATABASE_URL
 * Supports both direct connection and pooler formats
 */
function getSupabaseUrlFromDatabaseUrl(databaseUrl: string): string {
  // Try direct connection format: db.[ref].supabase.co
  let match = databaseUrl.match(/db\.([a-zA-Z0-9]+)\.supabase\.co/);
  
  if (!match) {
    // Try pooler format: postgres.[ref]:password
    match = databaseUrl.match(/postgres\.([a-zA-Z0-9]+):/);
  }
  
  if (match) {
    return `https://${match[1]}.supabase.co`;
  }
  
  throw new Error('Could not extract project reference from DATABASE_URL');
}

/**
 * Supabase Storage Service
 * Manages file uploads and downloads from Supabase Storage
 */
export class SupabaseStorageService {
  private supabase: SupabaseClient;
  private bucketName: string = 'portilho';

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    if (!anonKey) {
      throw new Error('SUPABASE_ANON_KEY environment variable is not set');
    }

    const supabaseUrl = getSupabaseUrlFromDatabaseUrl(databaseUrl);
    console.log('[SupabaseStorage] Initializing with URL:', supabaseUrl);

    this.supabase = createClient(supabaseUrl, anonKey);
  }

  /**
   * Upload a file to Supabase Storage
   * @param file - File buffer
   * @param filename - Name of the file
   * @param leadId - Lead ID for organizing files
   * @param mimeType - MIME type of the file
   * @returns URL of the uploaded file
   */
  async uploadDocument(
    file: Buffer,
    filename: string,
    leadId: string,
    mimeType: string
  ): Promise<string> {
    try {
      // Create a unique path for the file: leads/{leadId}/{timestamp}-{filename}
      const timestamp = Date.now();
      const filePath = `leads/${leadId}/${timestamp}-${filename}`;

      console.log('[SupabaseStorage] Uploading file:', filePath);

      // Upload to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          contentType: mimeType,
          upsert: false
        });

      if (error) {
        console.error('[SupabaseStorage] Upload error:', error);
        throw new Error(`Failed to upload file: ${error.message}`);
      }

      console.log('[SupabaseStorage] Upload successful:', data.path);

      // Return the file path (will be used to generate signed URL for download)
      return data.path;
    } catch (error) {
      console.error('[SupabaseStorage] Upload failed:', error);
      throw error;
    }
  }

  /**
   * Get a signed URL for downloading a file
   * @param filePath - Path to the file in storage
   * @param expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns Signed URL for downloading the file
   */
  async getSignedUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
    try {
      console.log('[SupabaseStorage] Getting signed URL for:', filePath);

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .createSignedUrl(filePath, expiresIn);

      if (error) {
        console.error('[SupabaseStorage] Signed URL error:', error);
        throw new Error(`Failed to create signed URL: ${error.message}`);
      }

      if (!data?.signedUrl) {
        throw new Error('Signed URL not returned from Supabase');
      }

      console.log('[SupabaseStorage] Signed URL created successfully');
      return data.signedUrl;
    } catch (error) {
      console.error('[SupabaseStorage] Failed to get signed URL:', error);
      throw error;
    }
  }

  /**
   * Download a file from Supabase Storage
   * @param filePath - Path to the file in storage
   * @returns File buffer
   */
  async downloadDocument(filePath: string): Promise<Buffer> {
    try {
      console.log('[SupabaseStorage] Downloading file:', filePath);

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .download(filePath);

      if (error) {
        console.error('[SupabaseStorage] Download error:', error);
        throw new Error(`Failed to download file: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data returned from Supabase');
      }

      // Convert Blob to Buffer
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log('[SupabaseStorage] Download successful, size:', buffer.length);
      return buffer;
    } catch (error) {
      console.error('[SupabaseStorage] Download failed:', error);
      throw error;
    }
  }

  /**
   * Delete a file from Supabase Storage
   * @param filePath - Path to the file in storage
   */
  async deleteDocument(filePath: string): Promise<void> {
    try {
      console.log('[SupabaseStorage] Deleting file:', filePath);

      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .remove([filePath]);

      if (error) {
        console.error('[SupabaseStorage] Delete error:', error);
        throw new Error(`Failed to delete file: ${error.message}`);
      }

      console.log('[SupabaseStorage] File deleted successfully');
    } catch (error) {
      console.error('[SupabaseStorage] Delete failed:', error);
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
      console.log('[SupabaseStorage] Listing documents for lead:', leadId);

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .list(`leads/${leadId}`, {
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) {
        console.error('[SupabaseStorage] List error:', error);
        throw new Error(`Failed to list files: ${error.message}`);
      }

      console.log('[SupabaseStorage] Found', data?.length || 0, 'documents');
      return data || [];
    } catch (error) {
      console.error('[SupabaseStorage] List failed:', error);
      throw error;
    }
  }
}
