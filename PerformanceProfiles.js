/**
 * Performance profiles for WhisperRN transcription with different speed/accuracy tradeoffs
 */

/**
 * Available performance profiles for transcription
 */
export const PERFORMANCE_PROFILES = {
  'highest-accuracy': {
    modelFile: 'ggml-large-v3-q5_0.bin',
    bestOf: 3,
    beamSize: 5,
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 6 * 60 * 1000,  // 6 minutes
    overlapMs: 10 * 1000,        // 10 seconds
    description: 'Maximum accuracy for critical content. Slowest processing.'
  },
  'accurate': {
    modelFile: 'ggml-large-v3-q5_0.bin',
    bestOf: 2,
    beamSize: 4,
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 5 * 60 * 1000,  // 5 minutes
    overlapMs: 8 * 1000,         // 8 seconds
    description: 'High accuracy with reasonable processing time.'
  },
  'balanced': {
    modelFile: 'ggml-large-v3-q5_0.bin',
    bestOf: 1,
    beamSize: 3, 
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 5 * 60 * 1000,  // 5 minutes
    overlapMs: 6 * 1000,         // 6 seconds
    description: 'Good balance between speed and accuracy.'
  },
  'fast': {
    modelFile: 'ggml-large-v3-turbo-q5_0.bin',
    bestOf: 1,
    beamSize: 3,
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 4 * 60 * 1000,  // 4 minutes
    overlapMs: 5 * 1000,         // 5 seconds
    description: 'Faster processing with good accuracy for most content.'
  },
  'fastest': {
    modelFile: 'ggml-large-v3-turbo-q5_0.bin',
    bestOf: 1,
    beamSize: 1,
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 3 * 60 * 1000,  // 3 minutes
    overlapMs: 4 * 1000,         // 4 seconds
    description: 'Maximum speed with acceptable accuracy for clean audio.'
  }
};

/**
 * Default performance profile - start with balanced for best experience
 */
export const DEFAULT_PERFORMANCE_MODE = 'balanced';

/**
 * Get the speed percentage for position indicator in UI
 */
export const getSpeedPercentage = (mode) => {
  const speedMap = {
    'highest-accuracy': 0,    // leftmost (most accurate)
    'accurate': 25,
    'balanced': 50,
    'fast': 75,
    'fastest': 100           // rightmost (fastest)
  };
  return speedMap[mode] || 50;
};

/**
 * Get estimated speed improvement ratio compared to baseline
 */
export const getSpeedRatio = (mode) => {
  const ratioMap = {
    'highest-accuracy': 1.0,  // baseline
    'accurate': 1.5,          // 1.5x faster
    'balanced': 2.5,          // 2.5x faster
    'fast': 3.5,              // 3.5x faster
    'fastest': 5.0            // 5x faster
  };
  return ratioMap[mode] || 1.0;
};

/**
 * Get transcription options based on selected performance profile
 */
export const getTranscriptionOptions = (performanceMode) => {
  const profile = PERFORMANCE_PROFILES[performanceMode] || PERFORMANCE_PROFILES[DEFAULT_PERFORMANCE_MODE];
  
  return {
    // Core transcription parameters
    bestOf: profile.bestOf,
    beamSize: profile.beamSize,
    temperature: profile.temperature,
    
    // Additional options
    language: 'auto',
    translateToEnglish: false,
    singleSegment: false,
    wordTimestamps: true,
    maxThreads: profile.maxThreads,
    
    // GPU acceleration (A17 Pro)
    useGpu: true,
    useFlashAttn: true
  };
};