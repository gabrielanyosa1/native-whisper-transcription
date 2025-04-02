/**
 * Model manager for WhisperRN transcription.
 * Handles model file access, loading, downloading, and switching.
 */

import * as FileSystem from 'expo-file-system';
import { Platform, Alert } from 'react-native';
import { PERFORMANCE_PROFILES } from './PerformanceProfiles';

// Model URLs - these are the direct download links
const MODEL_URLS = {
  'ggml-large-v3-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin',
  'ggml-large-v3-turbo-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
};

// Model sizes for progress calculation (in bytes)
const MODEL_SIZES = {
  'ggml-large-v3-q5_0.bin': 1070566415, // ~1.07 GB
  'ggml-large-v3-turbo-q5_0.bin': 574296731 // ~574 MB
};

/**
 * ModelManager handles model file access, loading, and switching.
 */
export class ModelManager {
  /**
   * Create a new ModelManager instance
   */
  constructor(options) {
    const { 
      initWhisper,
      onProgress = () => {},
      onStatusUpdate = () => {}
    } = options || {};

    this.initWhisper = initWhisper;
    this.onProgress = onProgress;
    this.onStatusUpdate = onStatusUpdate;
    
    // Internal state
    this.currentModelRef = null;
    this.currentModelFile = null;
    this.downloadProgresses = {};
  }

  /**
   * Check if a model is downloaded
   */
  async isModelDownloaded(modelFileName) {
    const modelPath = FileSystem.documentDirectory + modelFileName;
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    return fileInfo.exists;
  }

  /**
   * Download a model if it doesn't exist
   */
  async downloadModelIfNeeded(modelFileName, forceDownload = false) {
    const modelPath = FileSystem.documentDirectory + modelFileName;
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    
    // If model exists and we're not forcing a download, use it
    if (fileInfo.exists && !forceDownload) {
      console.log(`Model ${modelFileName} already exists at ${modelPath}`);
      return modelPath;
    }
    
    const modelUrl = MODEL_URLS[modelFileName];
    if (!modelUrl) {
      throw new Error(`No download URL defined for model: ${modelFileName}`);
    }
    
    this.onStatusUpdate(`Downloading ${modelFileName}...`);
    console.log(`Downloading model from ${modelUrl} to ${modelPath}`);
    
    // Create a download resumer
    const downloadResumable = FileSystem.createDownloadResumable(
      modelUrl,
      modelPath,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / MODEL_SIZES[modelFileName];
        this.downloadProgresses[modelFileName] = progress;
        
        // Calculate overall progress (if downloading multiple models)
        let overallProgress = 0;
        let progressCount = 0;
        for (const key in this.downloadProgresses) {
          overallProgress += this.downloadProgresses[key];
          progressCount++;
        }
        
        const averageProgress = progressCount > 0 ? overallProgress / progressCount : 0;
        this.onProgress(averageProgress);
        
        // Log progress every 10%
        if (Math.floor(progress * 10) > Math.floor((progress - (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite)) * 10)) {
          console.log(`Download progress: ${(progress * 100).toFixed(1)}%`);
        }
      }
    );
    
    try {
      const { uri } = await downloadResumable.downloadAsync();
      console.log(`Model downloaded to: ${uri}`);
      this.onStatusUpdate(`Model ${modelFileName} downloaded successfully`);
      
      // Remove this model from the progress tracking
      delete this.downloadProgresses[modelFileName];
      
      // Verify the download
      const downloadedFileInfo = await FileSystem.getInfoAsync(modelPath);
      if (!downloadedFileInfo.exists) {
        throw new Error(`Downloaded file doesn't exist at ${modelPath}`);
      }
      
      console.log(`Downloaded file size: ${downloadedFileInfo.size} bytes`);
      
      // Check if the size is reasonable (at least 50% of expected)
      const expectedSize = MODEL_SIZES[modelFileName];
      if (downloadedFileInfo.size < expectedSize * 0.5) {
        console.warn(`Downloaded file size ${downloadedFileInfo.size} is much smaller than expected ${expectedSize}`);
        throw new Error('Downloaded model appears to be incomplete');
      }
      
      return modelPath;
    } catch (error) {
      console.error(`Error downloading model ${modelFileName}:`, error);
      
      // Try to delete the partial download
      try {
        const fileExists = await FileSystem.getInfoAsync(modelPath);
        if (fileExists.exists) {
          await FileSystem.deleteAsync(modelPath, { idempotent: true });
          console.log(`Deleted partial download at ${modelPath}`);
        }
      } catch (e) {
        console.warn('Could not delete partial download:', e);
      }
      
      throw new Error(`Failed to download model: ${error.message}`);
    }
  }

  /**
   * Get the path to a model file - first checking if it needs to be downloaded
   */
  async getModelPath(modelFileName) {
    try {
      return await this.downloadModelIfNeeded(modelFileName);
    } catch (error) {
      console.error(`Error getting model path for ${modelFileName}:`, error);
      throw error;
    }
  }

  /**
   * Load a Whisper model
   */
  async loadModel(performanceMode) {
    try {
      // Get the profile for the selected performance mode
      const profile = PERFORMANCE_PROFILES[performanceMode];
      if (!profile) {
        throw new Error(`Invalid performance mode: ${performanceMode}`);
      }
      
      const modelFileName = profile.modelFile;
      console.log(`Loading model for performance mode ${performanceMode}: ${modelFileName}`);
      
      // If the same model is already loaded, reuse it
      if (this.currentModelRef && this.currentModelFile === modelFileName) {
        this.onStatusUpdate(`Using loaded model: ${modelFileName}`);
        return this.currentModelRef;
      }
      
      // Release existing model if needed
      await this.releaseModel();
      
      // Check if model is downloaded, and download if needed
      this.onStatusUpdate(`Preparing model: ${modelFileName}...`);
      this.onProgress(0.1);
      
      const isDownloaded = await this.isModelDownloaded(modelFileName);
      if (!isDownloaded) {
        try {
          // Show alert to user before starting large download
          await new Promise((resolve, reject) => {
            Alert.alert(
              'Model Download Required',
              `The ${performanceMode} mode requires downloading the ${modelFileName} model file (${(MODEL_SIZES[modelFileName] / (1024 * 1024 * 1024)).toFixed(1)} GB). Continue?`,
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: () => reject(new Error('Download cancelled by user'))
                },
                {
                  text: 'Download',
                  onPress: resolve
                }
              ]
            );
          });
        } catch (error) {
          console.log('Download cancelled:', error);
          throw error;
        }
      }
      
      const modelPath = await this.getModelPath(modelFileName);
      console.log(`Using model at path: ${modelPath}`);
      
      // Initialize whisper
      this.onStatusUpdate('Initializing Whisper model with GPU acceleration...');
      this.onProgress(0.9);
      
      const whisperContext = await this.initWhisper({
        filePath: modelPath,
        useGpu: true,
        useFlashAttn: true
      });
      
      // Log if GPU is being used for debugging
      console.log('Whisper model loaded with GPU:', whisperContext.gpu);
      if (!whisperContext.gpu) {
        console.log('Reason GPU not enabled:', whisperContext.reasonNoGPU);
      }
      
      // Store references
      this.currentModelRef = whisperContext;
      this.currentModelFile = modelFileName;
      
      this.onStatusUpdate(`Model loaded: ${modelFileName}`);
      this.onProgress(1.0);
      
      return whisperContext;
    } catch (error) {
      console.error('Model loading error:', error);
      throw error;
    }
  }

  /**
   * Release the current model
   */
  async releaseModel() {
    if (this.currentModelRef) {
      try {
        console.log(`Releasing current model: ${this.currentModelFile}`);
        // Call release method if available
        if (typeof this.currentModelRef.release === 'function') {
          await this.currentModelRef.release();
        }
      } catch (error) {
        console.warn('Error releasing model:', error);
      }
      
      this.currentModelRef = null;
      this.currentModelFile = null;
    }
  }

  /**
   * Check if a model is currently loaded
   */
  isModelLoaded() {
    return this.currentModelRef !== null;
  }
  
  /**
   * Check if loading a new performance mode requires a model change
   */
  doesRequireModelChange(newPerformanceMode) {
    // If no model is loaded, always need to load
    if (!this.currentModelFile) {
      return true;
    }
    
    // Get the model file for the new performance mode
    const newProfile = PERFORMANCE_PROFILES[newPerformanceMode];
    if (!newProfile) {
      return false;
    }
    
    // Compare model files
    const requiresChange = this.currentModelFile !== newProfile.modelFile;
    if (requiresChange) {
      console.log(`Model change required: ${this.currentModelFile} -> ${newProfile.modelFile}`);
    }
    return requiresChange;
  }
  
  /**
   * Get the download size for a model
   */
  getModelSizeInMB(modelFileName) {
    const sizeInBytes = MODEL_SIZES[modelFileName] || 0;
    return (sizeInBytes / (1024 * 1024)).toFixed(1);
  }
  
  /**
   * Delete all downloaded models to free up space
   */
  async deleteAllModels() {
    try {
      // First, release any loaded model
      await this.releaseModel();
      
      // Then delete all model files
      for (const modelFileName in MODEL_URLS) {
        const modelPath = FileSystem.documentDirectory + modelFileName;
        const fileInfo = await FileSystem.getInfoAsync(modelPath);
        
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(modelPath, { idempotent: true });
          console.log(`Deleted model: ${modelPath}`);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error deleting models:', error);
      return false;
    }
  }
}
