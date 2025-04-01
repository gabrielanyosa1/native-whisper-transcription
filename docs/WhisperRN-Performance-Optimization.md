# WhisperRN iOS Performance Optimization
## Design Document

**Author:** Gabriel Anyosa
**Date:** April 1, 2025  
**Status:** Draft  
**Document Version:** 1.0  

## Table of Contents
1. [Overview](#1-overview)
2. [Background](#2-background)
3. [Goals](#3-goals)
4. [Non-Goals](#4-non-goals)
5. [Current Implementation Analysis](#5-current-implementation-analysis)
6. [System Design](#6-system-design)
   - [6.1 Performance Profiles](#61-performance-profiles)
   - [6.2 Chunking Implementation](#62-chunking-implementation)
   - [6.3 GPU Acceleration](#63-gpu-acceleration)
   - [6.4 Model Selection](#64-model-selection)
   - [6.5 Audio Format Handling](#65-audio-format-handling)
7. [Implementation Plan](#7-implementation-plan)
   - [7.1 Core Components](#71-core-components)
   - [7.2 UI Integration](#72-ui-integration)
   - [7.3 Model Management](#73-model-management)
   - [7.4 Audio Processing](#74-audio-processing)
8. [Performance Considerations](#8-performance-considerations)
9. [Testing Strategy](#9-testing-strategy)
10. [Future Extensions](#10-future-extensions)
11. [Implementation Details](#11-implementation-details)
    - [11.1 Error Handling Strategy](#111-error-handling-strategy)
    - [11.2 Audio Extraction Implementation](#112-audio-extraction-implementation)
    - [11.3 Audio Duration Detection](#113-audio-duration-detection)
    - [11.4 Progress Tracking Implementation](#114-progress-tracking-implementation)
12. [Deployment and Distribution](#12-deployment-and-distribution)
    - [12.1 EAS Build Configuration](#121-eas-build-configuration)
    - [12.2 App Size Considerations](#122-app-size-considerations)
    - [12.3 App Store Compliance](#123-app-store-compliance)
13. [Risk Assessment and Mitigation](#13-risk-assessment-and-mitigation)
    - [13.1 Performance Risks](#131-performance-risks)
    - [13.2 Audio Format Risks](#132-audio-format-risks)
    - [13.3 Model Management Risks](#133-model-management-risks)
14. [Success Metrics](#14-success-metrics)
    - [14.1 Performance Metrics](#141-performance-metrics)
    - [14.2 User Experience Metrics](#142-user-experience-metrics)
    - [14.3 Audio Format Handling](#143-audio-format-handling)
15. [Appendices](#15-appendices)
    - [A. Performance Profile Parameters](#a-performance-profile-parameters)
    - [B. Code Samples](#b-code-samples)

---

## 1. Overview

This design document outlines a comprehensive approach to optimize the WhisperRN iOS application for improved transcription performance, balancing accuracy and processing speed. The document focuses on implementing a tiered performance model system, audio chunking mechanisms, GPU acceleration, and audio format compatibility.

---

## 2. Background

The current WhisperRN implementation exhibits suboptimal performance, with a 1:1 processing ratio (26 minutes for 26 minutes of audio) using the large-v3-q5_0 model with bestOf=3 and temperature=0.0 settings. The application runs on iOS devices, specifically targeting iPhone 15 Pro with A17 Pro chip.

Key components of the current system:
- React Native application using Expo
- WhisperRN library (React Native binding of whisper.cpp)
- Model: ggml-large-v3-q5_0.bin (1.08 GB)
- Current parameters: bestOf=3, temperature=0.0
- Target platform: iPhone 15 Pro with A17 Pro chip

The application has been experiencing out-of-memory (OOM) issues due to redundant model loading and format compatibility problems with iOS audio files (M4A).

---

## 3. Goals

- Reduce transcription processing time by at least 3-4x for standard usage
- Implement tiered performance modes from highest accuracy to fastest
- Add audio chunking to prevent memory issues with long recordings
- Enable GPU acceleration for the A17 Pro chip
- Resolve audio format compatibility issues
- Provide user interface for selecting performance modes
- Maintain single model loading to prevent memory issues

---

## 4. Non-Goals

- Android platform optimizations
- Streaming transcription optimizations
- Custom model training
- Server-side processing
- Adding CoreML support (mentioned as not currently available)
- Supporting languages beyond what Whisper models natively support

---

## 5. Current Implementation Analysis

### 5.1 Performance Issues

The current implementation has several bottlenecks:

1. **Inefficient Parameter Selection**: Using bestOf=3 significantly increases processing time without proportional accuracy improvements.

2. **No Chunking**: Processing long audio files as a single unit leads to:
   - High memory usage
   - No progressive feedback to users
   - Potential for OOM crashes

3. **No GPU Acceleration**: Not utilizing the A17 Pro's powerful GPU capabilities.

4. **Audio Format Incompatibilities**: iOS recordings in M4A format not properly handled.

5. **Model Loading**: Repetitive model loading causing memory pressure.

### 5.2 Memory Analysis

Based on the provided code and notes, we identified that the model was being loaded multiple times, leading to extreme memory overhead and eventual OOM crashes after the third transcription.

### 5.3 Audio Format Issues

The "*splash*" output observed during transcription attempts indicates format compatibility issues. WhisperRN expects 16kHz WAV files, but iOS recordings and many local files use different formats.

---

## 6. System Design

### 6.1 Performance Profiles

We will implement a tiered approach with five distinct performance profiles:

| Profile | Model | bestOf | beamSize | Chunk Size | Expected Speed |
|---------|-------|--------|----------|------------|----------------|
| Highest Accuracy | large-v3-q5_0 | 3 | 5 | 6 min | 1x (baseline) |
| Accurate | large-v3-q5_0 | 2 | 4 | 5 min | ~1.5x |
| Balanced | large-v3-q5_0 | 1 | 3 | 5 min | ~2.5x |
| Fast | large-v3-turbo-q5_0 | 1 | 3 | 4 min | ~3.5x |
| Fastest | large-v3-turbo-q5_0 | 1 | 1 | 3 min | ~5x |

Each profile will have:
- Predefined transcription parameters
- Specific chunking settings
- Associated model file
- User-friendly description

The detailed parameters for each profile are defined in Appendix A.

### 6.2 Chunking Implementation

Audio chunking will be implemented to:
1. Process large files in manageable segments
2. Prevent memory pressure
3. Provide progressive feedback to users

Key considerations:
- Each performance profile will have optimized chunk size
- Overlapping segments will ensure continuity at boundaries
- Results will be merged with special handling for overlapped sections

The chunking algorithm will:
1. Determine audio duration
2. Split audio into chunks with defined overlap
3. Process each chunk sequentially or in parallel (based on device capabilities)
4. Merge transcriptions with overlap resolution

### 6.3 GPU Acceleration

The iPhone 15 Pro's A17 Pro chip offers significant GPU capabilities that can accelerate ML inference. We will:

1. Enable GPU acceleration via WhisperRN options:
   ```javascript
   useGpu: true,
   useFlashAttn: true
   ```

2. Monitor GPU utilization and fallback mechanisms

3. Implement proper error handling if GPU is unavailable

### 6.4 Model Selection

We will support two models:
1. **ggml-large-v3-q5_0.bin** (1.08 GB) - For highest accuracy
2. **ggml-large-v3-turbo-q5_0.bin** (574 MB) - For faster processing

The model selection will be tied to the performance profile, with the system dynamically loading the appropriate model based on user selection.

### 6.5 Audio Format Handling

To address the format compatibility issues:

1. Implement proper format detection for audio files
2. Configure audio recording to use WAV format at 16kHz
3. Use ffmpeg-kit-react-native for format conversion when necessary
4. Add user warnings and feedback for incompatible formats

---

## 7. Implementation Plan

### 7.1 Core Components

#### 7.1.1 Performance Profile Manager

This component will:
- Store definitions of all performance profiles
- Provide methods to apply profile settings
- Handle profile switching logic

```javascript
// Profile definition structure
const performanceProfiles = {
  'highest-accuracy': {
    modelFile: 'ggml-large-v3-q5_0.bin',
    bestOf: 3,
    beamSize: 5,
    temperature: 0.0,
    maxThreads: 6,
    chunkSizeMs: 6 * 60 * 1000,
    overlapMs: 10 * 1000,
    description: 'Maximum accuracy for critical content. Slowest processing.'
  },
  // Additional profiles defined here
};
```

#### 7.1.2 Audio Chunking Service

This service will:
- Split audio files into chunks
- Manage processing of chunks
- Combine transcription results

```javascript
class AudioChunker {
  constructor(profile) {
    this.chunkSize = profile.chunkSizeMs;
    this.overlap = profile.overlapMs;
  }

  async chunkAudio(audioPath) {
    // Get audio metadata
    // Split into chunks
    // Return chunk information
  }

  mergeTranscriptionResults(results) {
    // Combine chunk transcriptions
    // Handle overlapping segments
    // Return unified transcription
  }
}
```

#### 7.1.3 Model Manager

This component will:
- Handle model file access and loading
- Manage model switching
- Ensure proper cleanup when switching models

```javascript
class ModelManager {
  constructor() {
    this.currentModelRef = null;
    this.currentModelFile = null;
  }

  async loadModel(modelFile, options) {
    // Cleanup existing model if needed
    // Load new model
    // Return model reference
  }

  async releaseModel() {
    // Release model resources
  }
}
```

#### 7.1.4 Audio Format Handler

This component will:
- Detect audio file formats
- Convert incompatible formats to 16kHz WAV
- Configure proper recording settings

```javascript
// Audio format detection
const isWavFile = (filePath) => {
  if (typeof filePath === 'string') {
    return filePath.toLowerCase().endsWith('.wav');
  }
  return true; // For require() assets
};

// Format conversion
const convertToWavFormat = async (inputPath) => {
  // Use ffmpeg-kit-react-native for conversion
  // Return path to converted file
};
```

### 7.2 UI Integration

#### 7.2.1 Performance Mode Selector

A UI component allowing users to select performance modes:

```javascript
const PerformanceModeSelector = ({ currentMode, onChange }) => {
  return (
    <View style={styles.performanceContainer}>
      <Text style={styles.performanceTitle}>Transcription Performance</Text>
      
      <View style={styles.modeContainer}>
        {/* Mode options rendered here */}
      </View>
      
      <Text style={styles.modeDescription}>
        {performanceProfiles[currentMode].description}
      </Text>
    </View>
  );
};
```

#### 7.2.2 Progress Feedback

Enhanced progress indicators for:
- Chunking progress
- Per-chunk transcription progress
- Overall progress
- Format conversion progress

### 7.3 Model Management

#### 7.3.1 Model Loading Strategy

1. On app initialization:
   - Load default model (balanced profile)
   - Store model reference in whisperContextRef

2. On performance mode change:
   - Check if model file needs to change
   - If yes, release current model and load new one
   - If no, maintain current model and update parameters

#### 7.3.2 Model Files Management

Handle both models:
- ggml-large-v3-q5_0.bin (1.08GB)
- ggml-large-v3-turbo-q5_0.bin (574MB)

Store in app's document directory and copy on first use.

### 7.4 Audio Processing

#### 7.4.1 Recording Configuration

```javascript
const getAudioRecordingOptions = () => {
  return {
    ios: {
      extension: '.wav',
      audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
      outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEARPCM,
    },
    // Additional platform configurations
  };
};
```

#### 7.4.2 File Selection and Processing

1. Select audio file
2. Detect format
3. Convert if necessary
4. Chunk audio
5. Process chunks
6. Merge results

---

## 8. Performance Considerations

### 8.1 Memory Management

- Single model instance maintained throughout app lifecycle
- Explicit resource cleanup on app closing
- Temporary file management for converted audio and chunks

### 8.2 Processing Time Estimates

Based on the provided data point (26 minutes of audio taking 26 minutes to process with bestOf=3):

| Profile | Expected Processing Time (26min audio) |
|---------|---------------------------------------|
| Highest Accuracy | ~26 minutes |
| Accurate | ~17-18 minutes |
| Balanced | ~10-12 minutes |
| Fast | ~7-8 minutes |
| Fastest | ~5-6 minutes |

### 8.3 Battery Impact

GPU acceleration increases performance but may have higher power consumption. We will:
- Monitor battery impact during testing
- Consider adding a "low power" mode that disables GPU for battery-critical situations

### 8.4 Storage Considerations

- Model files: ~1.65GB total (both models)
- Temporary storage: ~50-100MB for audio processing
- Ensure cleanup of temporary files

---

## 9. Testing Strategy

### 9.1 Performance Testing

Test with standardized audio files:
- Short (1-2 minutes)
- Medium (10-15 minutes)
- Long (30+ minutes)

Measure:
- Processing time
- Memory usage
- Battery consumption
- Accuracy (WER - Word Error Rate)

### 9.2 Format Compatibility Testing

Test with:
- WAV files (various sample rates)
- M4A (iOS recording)
- MP3 files
- Various other formats

### 9.3 Device Testing

Primary focus on iPhone 15 Pro, but also test on:
- Older iOS devices (if available)
- Different iOS versions

### 9.4 Stress Testing

- Multiple consecutive transcriptions
- Very long audio files (1+ hour)
- Low-memory conditions

---

## 10. Future Extensions

Potential future enhancements outside the scope of this document:

1. CoreML integration (when available)
2. Parallel chunk processing
3. Streaming transcription optimizations
4. More advanced audio pre-processing
5. Android optimization
6. Custom fine-tuned models

---

## 11. Implementation Details

### 11.1 Error Handling Strategy

Robust error handling is critical for a production application. The main categories of errors to handle are:

#### 11.1.1 Model Loading Errors

```javascript
try {
  // Model loading code
} catch (error) {
  // Log detailed error information
  console.error('Model loading error:', error);
  
  // Check for specific error types
  if (error.message.includes('memory')) {
    // Memory-related issue
    Alert.alert(
      'Memory Error',
      'Not enough memory to load the model. Try closing other apps and restarting.',
      [{ text: 'OK' }]
    );
  } else if (error.message.includes('file') || error.message.includes('path')) {
    // File access or path issue
    Alert.alert(
      'File Error',
      'Could not access the model file. The app may need to be reinstalled.',
      [{ text: 'OK' }]
    );
  } else {
    // Generic error
    Alert.alert(
      'Model Loading Error',
      'There was an error loading the transcription model. Please restart the app.',
      [{ text: 'OK' }]
    );
  }
  
  // Set application state to reflect error
  setIsModelLoaded(false);
  setIsLoading(false);
}
```

#### 11.1.2 Audio Processing Errors

```javascript
try {
  // Audio processing code
} catch (error) {
  console.error('Audio processing error:', error);
  
  if (error.message.includes('format') || error.message.includes('conversion')) {
    Alert.alert(
      'Audio Format Error',
      'Could not process this audio format. Try converting to WAV first.',
      [{ text: 'OK' }]
    );
  } else if (error.message.includes('permission')) {
    Alert.alert(
      'Permission Error',
      'Microphone or file access permission denied. Please check app permissions.',
      [{ text: 'OK' }]
    );
  } else {
    Alert.alert(
      'Processing Error',
      'Error processing audio. Please try again with a different file.',
      [{ text: 'OK' }]
    );
  }
  
  setIsLoading(false);
}
```

#### 11.1.3 Transcription Errors

```javascript
try {
  // Transcription code
} catch (error) {
  console.error('Transcription error:', error);
  
  if (error.message.includes('interrupted') || error.message.includes('stop')) {
    // User interrupted transcription
    setStatus('Transcription cancelled');
  } else if (error.message.includes('memory')) {
    Alert.alert(
      'Memory Error',
      'Out of memory during transcription. Try using a smaller audio file or faster mode.',
      [{ text: 'OK' }]
    );
  } else {
    Alert.alert(
      'Transcription Error',
      'Error during transcription. Please try again or try a different performance mode.',
      [{ text: 'OK' }]
    );
  }
  
  setIsLoading(false);
}
```

### 11.2 Audio Extraction Implementation

For chunking to work, we need to extract segments from the audio file. This can be implemented using FFmpeg:

```javascript
const extractAudioSegment = async (audioPath, startMs, endMs) => {
  try {
    // Create a unique name for the chunk file
    const outputPath = `${FileSystem.cacheDirectory}chunk_${Date.now()}_${Math.floor(Math.random() * 1000)}.wav`;
    
    // Format start and end time for FFmpeg (format: HH:MM:SS.mmm)
    const formatTime = (ms) => {
      const totalSeconds = ms / 1000;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const milliseconds = Math.floor(ms % 1000);
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    };
    
    const startTime = formatTime(startMs);
    const duration = formatTime(endMs - startMs);
    
    // Create FFmpeg command to extract segment
    const command = `-i "${audioPath}" -ss ${startTime} -t ${duration} -c:a pcm_s16le -ar 16000 -ac 1 "${outputPath}"`;
    
    // Execute FFmpeg command
    return new Promise((resolve, reject) => {
      FFmpegKit.executeAsync(
        command,
        async (session) => {
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) {
            resolve(outputPath);
          } else {
            const output = await session.getOutput();
            reject(new Error(`FFmpeg error: ${output}`));
          }
        },
        (log) => {
          console.log(`FFmpeg log: ${log.getMessage()}`);
        },
        (statistics) => {
          // Progress can be monitored here if needed
        }
      );
    });
  } catch (error) {
    console.error('Error extracting audio segment:', error);
    throw error;
  }
};
```

### 11.3 Audio Duration Detection

To properly chunk audio, we need to detect its duration:

```javascript
const getAudioDuration = async (audioPath) => {
  try {
    // Use FFmpeg to get duration
    const command = `-i "${audioPath}" -v quiet -show_entries format=duration -of csv="p=0"`;
    
    return new Promise((resolve, reject) => {
      FFmpegKit.executeAsync(
        command,
        async (session) => {
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) {
            const output = await session.getOutput();
            // Output will be the duration in seconds
            const durationSeconds = parseFloat(output.trim());
            const durationMs = durationSeconds * 1000;
            resolve(durationMs);
          } else {
            reject(new Error('Failed to get audio duration'));
          }
        }
      );
    });
  } catch (error) {
    console.error('Error getting audio duration:', error);
    throw error;
  }
};
```

### 11.4 Progress Tracking Implementation

For long transcriptions, detailed progress tracking is essential:

```javascript
class TranscriptionProgressTracker {
  constructor(totalChunks) {
    this.totalChunks = totalChunks;
    this.currentChunk = 0;
    this.chunkProgress = 0;
    this.listeners = [];
  }
  
  updateChunkProgress(progress) {
    // progress: 0.0 to 1.0 for current chunk
    this.chunkProgress = progress;
    this.notifyListeners();
  }
  
  moveToNextChunk() {
    this.currentChunk++;
    this.chunkProgress = 0;
    this.notifyListeners();
  }
  
  getOverallProgress() {
    if (this.totalChunks <= 1) {
      return this.chunkProgress;
    }
    
    // Calculate weighted progress
    const chunkWeight = 1 / this.totalChunks;
    return (this.currentChunk * chunkWeight) + (this.chunkProgress * chunkWeight);
  }
  
  addListener(callback) {
    this.listeners.push(callback);
  }
  
  removeListener(callback) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }
  
  notifyListeners() {
    const progress = this.getOverallProgress();
    this.listeners.forEach(listener => listener(progress));
  }
}

// Usage:
const progressTracker = new TranscriptionProgressTracker(chunks.length);
progressTracker.addListener((progress) => {
  setProgress(progress);
  // Update UI, e.g., progress bar width
});

// During transcription:
progressTracker.updateChunkProgress(0.5); // 50% through current chunk
progressTracker.moveToNextChunk(); // Move to next chunk
```

## 12. Deployment and Distribution

### 12.1 EAS Build Configuration

For Expo EAS builds, configure the appropriate settings in `eas.json`:

```json
{
  "cli": {
    "version": ">= 16.1.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "resourceClass": "m1-medium"
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "resourceClass": "m1-medium"
      }
    },
    "production": {
      "autoIncrement": true,
      "ios": {
        "resourceClass": "m1-medium"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 12.2 App Size Considerations

The two model files together are approximately 1.65GB, which will significantly impact app size:

1. **App Thinning**: Implement app thinning for iOS to reduce initial download size
2. **On-Demand Resources**: Consider downloading models on first run rather than bundling
3. **Progressive Models**: Start with smaller model, offer larger as download option

### 12.3 App Store Compliance

1. **Privacy Policy**: Update to reflect audio processing
2. **Permissions**: Ensure proper justification for microphone access
3. **App Review**: Prepare documentation explaining ML model usage

## 13. Risk Assessment and Mitigation

### 13.1 Performance Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| GPU acceleration not available | Low | High | Fallback to CPU with clear user messaging |
| Memory issues with long audio | Medium | High | Implement aggressive chunking with smaller sizes |
| Battery drain during processing | High | Medium | Add battery warning for long files |
| Slow processing on older devices | High | Medium | Adjust default performance profile based on device model |

### 13.2 Audio Format Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Unsupported audio formats | High | Medium | Comprehensive format detection and conversion |
| Corrupted audio files | Low | Medium | Robust error handling with clear messages |
| Conversion failures | Medium | High | Fallback options and user guidance |

### 13.3 Model Management Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Model file corruption | Low | High | Validation checks and re-download capability |
| Insufficient storage for models | Medium | High | Storage checks before model download |
| Model loading failures | Medium | High | Detailed error reporting and recovery options |

## 14. Success Metrics

To evaluate the success of the optimization efforts:

### 14.1 Performance Metrics

- Processing time ratio (aim for 3-5× improvement)
- Memory usage (no OOM crashes)
- Battery consumption per minute of audio

### 14.2 User Experience Metrics

- Time to first result (chunking provides initial results faster)
- User-selected performance profiles (track usage patterns)
- Failed transcription rate

### 14.3 Audio Format Handling

- Successful transcription rate by format
- Conversion success rate
- Format error rate

## 15. Appendices

### A. Performance Profile Parameters

Detailed parameters for each performance profile:

```javascript
const performanceProfiles = {
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
```

### B. Code Samples

#### B.1 Audio Chunking Implementation

```javascript
const transcribeWithChunking = async (audioPath, customOptions = {}) => {
  // Get current profile for chunking settings
  const profile = performanceProfiles[performanceMode];
  const chunkSize = profile.chunkSizeMs;
  const overlap = profile.overlapMs;
  
  try {
    // Get audio duration (implementation depends on platform)
    const audioDuration = await getAudioDuration(audioPath);
    let allResults = [];
    let allText = '';
    
    // Create chunks with overlap
    const chunks = [];
    for (let start = 0; start < audioDuration; start += chunkSize - overlap) {
      const end = Math.min(start + chunkSize, audioDuration);
      chunks.push({ start, end, index: chunks.length });
    }
    
    setStatus(`Processing audio in ${chunks.length} chunks...`);
    
    // Process each chunk sequentially
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setStatus(`Processing chunk ${i+1}/${chunks.length}...`);
      
      // Extract audio segment for this chunk
      // This would require platform-specific implementation
      const chunkPath = await extractAudioSegment(audioPath, chunk.start, chunk.end);
      
      // Set chunk-specific options
      const chunkOptions = {
        ...customOptions,
        offset: chunk.start,  // Tell Whisper where this chunk starts in the timeline
      };
      
      // Transcribe this chunk
      const { result } = await transcribeSingleChunk(chunkPath, chunkOptions);
      
      // Store result
      allResults.push({
        ...result,
        chunkIndex: chunk.index,
        startTime: chunk.start,
        endTime: chunk.end
      });
      
      // Update progress
      setProgress((i + 1) / chunks.length);
      
      // Clean up temporary chunk file
      await FileSystem.deleteAsync(chunkPath, { idempotent: true });
    }
    
    // Merge results (handle overlapping sections)
    const mergedResult = mergeTranscriptionResults(allResults, overlap);
    
    return mergedResult;
  } catch (error) {
    console.error('Error in chunked transcription:', error);
    throw error;
  }
};

// Helper for single chunk transcription
const transcribeSingleChunk = async (chunkPath, options) => {
  // Use the loaded whisper context for transcription
  const { promise } = whisperContextRef.current.transcribe(chunkPath, options);
  return await promise;
};

// Merge results from multiple chunks
const mergeTranscriptionResults = (results, overlapMs) => {
  // Sort results by chunk index
  results.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  // Initialize merged result
  let mergedText = '';
  let mergedSegments = [];
  
  // Process each chunk's results
  results.forEach((chunkResult, index) => {
    if (index === 0) {
      // For first chunk, take everything
      mergedText = chunkResult.result;
      mergedSegments = [...chunkResult.segments];
    } else {
      // For subsequent chunks, find overlap point
      // This is a simplified approach and would need more sophistication
      // for actual production implementation
      const overlapStart = chunkResult.startTime;
      const prevChunkEnd = results[index-1].endTime;
      const overlapDuration = prevChunkEnd - overlapStart;
      
      // Find segments that are likely in the overlap region
      // This is approximate and would need refinement
      const overlapThresholdStart = overlapStart + (overlapDuration * 0.2);
      const overlapThresholdEnd = prevChunkEnd - (overlapDuration * 0.2);
      
      // Filter segments from current chunk that are past the overlap
      const nonOverlappingSegments = chunkResult.segments.filter(seg => 
        seg.t0 >= overlapThresholdEnd
      );
      
      // Add non-overlapping text and segments
      // This is simplified - real implementation would need better text matching
      const textToAdd = extractTextFromSegments(nonOverlappingSegments);
      mergedText += ' ' + textToAdd;
      
      // Adjust timestamps for the merged segments
      nonOverlappingSegments.forEach(seg => {
        mergedSegments.push(seg);
      });
    }
  });
  
  return {
    result: mergedText.trim(),
    segments: mergedSegments,
  };
};
```

#### B.2 Model Loading with GPU Acceleration

```javascript
const loadWhisperModel = async () => {
  // Skip if model is already loaded
  if (whisperContextRef.current) {
    return;
  }
  
  try {
    setIsLoading(true);
    setStatus('Preparing Whisper model...');
    
    // Get the current profile
    const profile = performanceProfiles[performanceMode];
    
    // Get model path based on selected profile
    const modelFileName = profile.modelFile;
    const modelPath = FileSystem.documentDirectory + modelFileName;
    
    // Check if the model exists, if not copy it from bundled assets
    const fileInfo = await FileSystem.getInfoAsync(modelPath);
    if (!fileInfo.exists) {
      setStatus(`Copying ${modelFileName} (first launch only)...`);
      const bundlePath = FileSystem.bundleDirectory + modelFileName;
      await FileSystem.copyAsync({
        from: bundlePath,
        to: modelPath
      });
    }
    
    setStatus('Initializing Whisper model with GPU acceleration...');
    setProgress(0.3);
    
    // Initialize whisper with the model path and GPU acceleration
    whisperContextRef.current = await initWhisper({
      filePath: modelPath,
      useGpu: true,           // Enable GPU acceleration for faster processing
      useFlashAttn: true      // Enable Flash Attention (works with GPU)
    });
    
    // Log if GPU is being used for debugging
    console.log('Whisper model loaded with GPU:', whisperContextRef.current.gpu);
    if (!whisperContextRef.current.gpu) {
      console.log('Reason GPU not enabled:', whisperContextRef.current.reasonNoGPU);
    }
    
    setIsModelLoaded(true);
    setStatus(`Model loaded: ${modelFileName}`);
    setProgress(1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    // After a delay, reset UI to idle state
    setTimeout(() => {
      setIsLoading(false);
      setProgress(0);
    }, 1000);
    
  } catch (error) {
    console.error('Model loading error:', error);
    setStatus('Error loading model: ' + error.message);
    setIsLoading(false);
    Alert.alert(
      'Model Loading Error',
      'There was an error loading the transcription model. Please restart the app and try again.'
    );
  }
};
```

### B.3 Performance Mode Selector UI Component

```javascript
const PerformanceModeSelector = ({ currentMode, onChange }) => {
  return (
    <View style={styles.performanceContainer}>
      <Text style={styles.performanceTitle}>Transcription Performance</Text>
      
      <View style={styles.modeContainer}>
        <TouchableOpacity 
          style={[
            styles.modeOption, 
            currentMode === 'highest-accuracy' && styles.selectedMode
          ]}
          onPress={() => onChange('highest-accuracy')}
        >
          <Text style={[
            styles.modeText, 
            currentMode === 'highest-accuracy' && styles.selectedModeText
          ]}>
            Highest Accuracy
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.modeOption, 
            currentMode === 'accurate' && styles.selectedMode
          ]}
          onPress={() => onChange('accurate')}
        >
          <Text style={[
            styles.modeText, 
            currentMode === 'accurate' && styles.selectedModeText
          ]}>
            Accurate
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.modeOption, 
            currentMode === 'balanced' && styles.selectedMode
          ]}
          onPress={() => onChange('balanced')}
        >
          <Text style={[
            styles.modeText, 
            currentMode === 'balanced' && styles.selectedModeText
          ]}>
            Balanced
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.modeOption, 
            currentMode === 'fast' && styles.selectedMode
          ]}
          onPress={() => onChange('fast')}
        >
          <Text style={[
            styles.modeText, 
            currentMode === 'fast' && styles.selectedModeText
          ]}>
            Fast
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.modeOption, 
            currentMode === 'fastest' && styles.selectedMode
          ]}
          onPress={() => onChange('fastest')}
        >
          <Text style={[
            styles.modeText, 
            currentMode === 'fastest' && styles.selectedModeText
          ]}>
            Fastest
          </Text>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.modeDescription}>
        {performanceProfiles[currentMode].description}
      </Text>
      
      {/* Show estimated processing time indicator */}
      <View style={styles.estimatedTimeContainer}>
        <View style={styles.timeScale}>
          <View style={[styles.timeIndicator, {left: `${getSpeedPercentage(currentMode)}%`}]} />
          <Text style={styles.fasterLabel}>Faster</Text>
          <Text style={styles.accurateLabel}>More Accurate</Text>
        </View>
      </View>
    </View>
  );
};

// Helper function to get relative speed percentage for position indicator
const getSpeedPercentage = (mode) => {
  const speedMap = {
    'highest-accuracy': 0,    // leftmost (most accurate)
    'accurate': 25,
    'balanced': 50,
    'fast': 75,
    'fastest': 100           // rightmost (fastest)
  };
  return speedMap[mode];
};

// Additional styles
const additionalStyles = {
  // ... existing styles
  estimatedTimeContainer: {
    marginTop: 10,
    height: 20,
  },
  timeScale: {
    height: 4,
    backgroundColor: '#e1e4e8',
    marginVertical: 8,
    borderRadius: 2,
    position: 'relative'
  },
  timeIndicator: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#007aff',
    top: -4,
    marginLeft: -6,
  },
  fasterLabel: {
    position: 'absolute',
    right: 0,
    top: 8,
    fontSize: 10,
    color: '#888',
  },
  accurateLabel: {
    position: 'absolute',
    left: 0,
    top: 8,
    fontSize: 10,
    color: '#888',
  },
};
```

### B.4 Format Conversion Modal UI

```javascript
const FormatConversionModal = ({ visible, fileName, onCancel, onConvert, progress }) => {
  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Audio Format Conversion</Text>
          
          <Text style={styles.modalText}>
            The file "{fileName}" needs to be converted to WAV format for transcription.
          </Text>
          
          {progress > 0 ? (
            <View>
              <View style={styles.progressBarBackground}>
                <View 
                  style={[
                    styles.progressBarFill, 
                    {width: `${progress * 100}%`}
                  ]} 
                />
              </View>
              <Text style={styles.progressText}>
                Converting... {Math.round(progress * 100)}%
              </Text>
            </View>
          ) : (
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]} 
                onPress={onCancel}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.convertButton]} 
                onPress={onConvert}
              >
                <Text style={styles.convertButtonText}>Convert</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

// Additional styles
const modalStyles = {
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 5,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f1f1f1',
  },
  convertButton: {
    backgroundColor: '#007aff',
  },
  cancelButtonText: {
    color: '#333',
    fontWeight: '500',
  },
  convertButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#e1e4e8',
    borderRadius: 4,
    marginVertical: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  progressText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
};
```
```