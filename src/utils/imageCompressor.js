import Compressor from 'compressorjs';

/**
 * Compresses an image file if it is larger than 1MB.
 * @param {File} file - The image file to compress.
 * @returns {Promise<File|Blob>} - The compressed image file (or original if < 1MB).
 */
export const compressImageIfNeeded = (file) => {
  return new Promise((resolve, reject) => {
    // 1MB in bytes
    const MAX_SIZE = 1 * 1024 * 1024;

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      return reject(new Error('File is not an image'));
    }

    // If file is strictly smaller or equal to 1MB, return original
    if (file.size <= MAX_SIZE) {
      console.log('File is under 1MB. No compression needed.');
      return resolve(file);
    }

    console.log(`File is ${(file.size / 1024 / 1024).toFixed(2)}MB. Compressing...`);

    new Compressor(file, {
      quality: 0.6,
      maxWidth: 1920,
      maxHeight: 1920,
      success(result) {
        console.log(`Compression successful. New size: ${(result.size / 1024 / 1024).toFixed(2)}MB`);
        
        // Wrap the blob in a File object to retain the name and type
        const compressedFile = new File([result], file.name, {
            type: result.type,
            lastModified: Date.now(),
        });
        
        resolve(compressedFile);
      },
      error(err) {
        console.error('Compression error:', err.message);
        reject(err);
      },
    });
  });
};
