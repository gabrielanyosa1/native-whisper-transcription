// AVFoundationAudio.js - Native module bridge
import { NativeModules, Platform } from 'react-native';

// Try to get the native module
const nativeModule = Platform.OS === 'ios' ? NativeModules.AVFoundationAudio : null;

// Create the interface with fallbacks
const AVFoundationAudio = {
  // Get audio duration (in milliseconds)
  getAudioDuration: async (filePath) => {
    if (nativeModule && nativeModule.getAudioDuration) {
      try {
        return await nativeModule.getAudioDuration(filePath);
      } catch (error) {
        console.warn('Native getAudioDuration failed:', error);
        // Fall back to default
      }
    }
    
    console.log('Using fallback audio duration detection');
    return 60000; // Default 1 minute
  },
  
  // Extract a segment of audio to a new file
  extractAudioSegment: async (sourcePath, outputPath, startMs, durationMs) => {
    if (nativeModule && nativeModule.extractAudioSegment) {
      try {
        return await nativeModule.extractAudioSegment(
          sourcePath, 
          outputPath, 
          startMs, 
          durationMs
        );
      } catch (error) {
        console.error('Native extractAudioSegment failed:', error);
        throw error;
      }
    }
    
    console.error('Audio extraction not available (native module missing)');
    throw new Error('Audio extraction not supported without native module');
  },
  
  // Convert audio file to WAV format
  convertToWavFormat: async (sourcePath, outputPath) => {
    if (nativeModule && nativeModule.convertToWavFormat) {
      try {
        return await nativeModule.convertToWavFormat(sourcePath, outputPath);
      } catch (error) {
        console.error('Native convertToWavFormat failed:', error);
        throw error;
      }
    }
    
    console.error('Audio conversion not available (native module missing)');
    throw new Error('Audio conversion not supported without native module');
  },
  
  // Check if file is WAV format
  isWavFormat: async (filePath) => {
    if (nativeModule && nativeModule.isWavFormat) {
      try {
        return await nativeModule.isWavFormat(filePath);
      } catch (error) {
        console.warn('Native isWavFormat failed:', error);
        // Fall back to extension check
      }
    }
    
    // Simple extension check as fallback
    return filePath.toLowerCase().endsWith('.wav');
  }
};

// Log native module availability
if (Platform.OS === 'ios') {
  if (nativeModule) {
    console.log('AVFoundationAudio native module loaded successfully');
  } else {
    console.warn('AVFoundationAudio native module not found, using fallbacks');
  }
}

// Export as default for compatibility with existing imports
export default AVFoundationAudio;
