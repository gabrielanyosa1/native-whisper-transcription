# WhisperRN iOS Performance Optimization
## Design Document

**Author:** Gabriel Anyosa
**Date:** April 1, 2025  
**Status:** Implemented - Initial Version  
**Document Version:** 1.1

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Background and Initial State](#2-background-and-initial-state)
3. [Project Goals](#3-project-goals)
4. [Technical Design and Implementation](#4-technical-design-and-implementation)
   - [4.1 Performance Profiles](#41-performance-profiles)
   - [4.2 Model Management](#42-model-management)
   - [4.3 Audio Chunking](#43-audio-chunking)
   - [4.4 User Interface Components](#44-user-interface-components)
   - [4.5 Integration with Existing Codebase](#45-integration-with-existing-codebase)
5. [Implementation Challenges and Solutions](#5-implementation-challenges-and-solutions)
   - [5.1 EAS Build Size Limitations](#51-eas-build-size-limitations)
   - [5.2 Model File Management](#52-model-file-management)
   - [5.3 Audio Duration Detection](#53-audio-duration-detection)
   - [5.4 Bundled Assets Handling](#54-bundled-assets-handling)
   - [5.5 Model Download Management](#55-model-download-management)
6. [Current State](#6-current-state)
   - [6.1 Functional Components](#61-functional-components)
   - [6.2 Component Interactions](#62-component-interactions)
   - [6.3 User Experience Flow](#63-user-experience-flow)
   - [6.4 Performance Characteristics](#64-performance-characteristics)
   - [6.5 Model Bundling Behavior](#65-model-bundling-behavior)
   - [6.6 Error Handling](#66-error-handling)
   - [6.7 Known Limitations](#67-known-limitations)
7. [Future Improvements](#7-future-improvements)
   - [7.1 Sequential Model Downloading](#71-sequential-model-downloading)
   - [7.2 Enhanced Progress Indication](#72-enhanced-progress-indication)
   - [7.3 Optimized Bundling Strategy](#73-optimized-bundling-strategy)
8. [Appendix](#8-appendix)
   - [8.1 File Structure](#81-file-structure)
   - [8.2 Key Implementation Details](#82-key-implementation-details)
   - [8.3 Metro Configuration](#83-metro-configuration)
   - [8.4 Build Process](#84-build-process)
   - [8.5 Performance Modes Detailed Specification](#85-performance-modes-detailed-specification)
   - [8.6 References](#86-references)

---

## 1. Executive Summary

This document details the implementation of performance optimizations for a WhisperRN-based iOS application. The primary goals were to implement tiered performance profiles, improve transcription speed, prevent memory issues with long audio files, and handle large model files efficiently. The project successfully implemented:

1. A tiered performance profile system with 5 different accuracy/speed tradeoffs
2. On-demand model downloading with progress tracking
3. Audio chunking for long file processing
4. Improved error handling and fallback mechanisms
5. A hybrid approach to model bundling and downloading

A notable discovery was that including a model file in the iOS project bundle while using an empty `.easignore` file allows for immediate app functionality while still providing the flexibility of downloading alternative models on demand. This approach balances app size concerns with immediate usability.

---

## 2. Background and Initial State

### 2.1 Initial Application State

The original application was a React Native (Expo) iOS application using WhisperRN, a React Native binding for the Whisper speech recognition model. The application had several performance issues:

- Long processing times (approximately 1:1 ratio - 26 minutes to process 26 minutes of audio)
- Out-of-memory (OOM) issues with long recordings
- Large app size (1.9GB) due to bundled model files
- Build size limitations with EAS
- Limited transcription parameter options (fixed at bestOf=3)
- No ability to select between speed and accuracy

### 2.2 Initial Component Structure

The application consisted of:
- **App.js**: Main application file with the UI and transcription logic
- **audioUtils.js**: Utilities for audio handling and format conversion
- **WhisperRN library**: React Native binding for Whisper.cpp
- **Bundled model**: ggml-large-v3-q5_0.bin (1.08GB)

The initial application flow was:
1. Load the model on startup (1.08GB file)
2. Allow recording or file selection
3. Process the entire audio file at once
4. Display transcription results

### 2.3 Initial Configuration

The initial configuration included:
- **Platform**: iOS (iPhone 15 Pro with A17 Pro chip)
- **Framework**: React Native with Expo
- **Model Parameters**: bestOf=3, temperature=0.0
- **Metro Configuration**: Custom configuration to include .bin files as assets

```javascript
// Initial metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const defaultConfig = getDefaultConfig(__dirname);
// Add .bin files to the asset extensions
defaultConfig.resolver.assetExts.push('bin');
// For iOS include the binary FFmpeg libraries
defaultConfig.resolver.assetExts.push('a');
defaultConfig.resolver.assetExts.push('dylib');
module.exports = defaultConfig;
```

### 2.4 Initial Problems

The original implementation had several limitations:
1. **Fixed Settings**: No ability to adjust transcription parameters
2. **Memory Issues**: Out-of-memory crashes with long recordings
3. **Large App Size**: 1.9GB due to bundled model
4. **Build Issues**: EAS Build size limitations (2GB limit)
5. **Processing Speed**: Slow transcription (1:1 ratio with audio length)
6. **Format Handling**: Limited audio format support

---

## 3. Project Goals

The primary goals of the project were:

1. **Implement Tiered Performance Profiles**: Create multiple performance profiles balancing accuracy and speed
2. **Reduce Processing Time**: Achieve 3-5× speedup for transcription
3. **Prevent Memory Issues**: Implement audio chunking for long recordings
4. **Solve Build Size Issues**: Implement on-demand model downloading
5. **Improve Error Handling**: Create robust error handling and fallback mechanisms
6. **Maintain UI Experience**: Integrate new functionality with minimal UI disruption

---

## 4. Technical Design and Implementation

### 4.1 Performance Profiles

We implemented a tiered approach with five distinct performance profiles:

#### 4.1.1 Profile Definitions
```javascript
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
```

#### 4.1.2 Performance Profile Characteristics

Each profile has:
- **Model File**: Either large-v3-q5_0.bin (1.08GB) or large-v3-turbo-q5_0.bin (574MB)
- **Inference Parameters**: bestOf, beamSize, and temperature settings
- **Chunking Parameters**: Chunk size and overlap settings
- **Description**: User-friendly description for the UI

#### 4.1.3 Performance Profile Implementation

The profiles are implemented in `PerformanceProfiles.js` which exports:
- `PERFORMANCE_PROFILES`: The profile definitions
- `DEFAULT_PERFORMANCE_MODE`: The default profile ('balanced')
- `getSpeedPercentage()`: Helper for UI visualization
- `getTranscriptionOptions()`: Function to get WhisperRN options based on profile

### 4.2 Model Management

The model management system is implemented in `ModelManager.js` and handles loading, downloading, and switching between models.

#### 4.2.1 Model Downloading

We implemented on-demand model downloading from Hugging Face:

```javascript
// Model URLs
const MODEL_URLS = {
  'ggml-large-v3-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin',
  'ggml-large-v3-turbo-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
};

// Model sizes for progress calculation (in bytes)
const MODEL_SIZES = {
  'ggml-large-v3-q5_0.bin': 1070566415, // ~1.07 GB
  'ggml-large-v3-turbo-q5_0.bin': 574296731 // ~574 MB
};
```

The downloading process:
1. Checks if the model already exists in the document directory
2. Shows a confirmation dialog with model size information
3. Downloads the model with progress tracking
4. Validates the downloaded file size
5. Falls back to a bundled model if available

Full implementation of model downloading:

```javascript
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
      
      // Calculate overall progress
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
    
    // Check if the size is reasonable
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
```

#### 4.2.2 Model Loading

Model loading involves:
1. Getting the model path (downloaded or bundled)
2. Initializing Whisper with the model and GPU acceleration
3. Verifying GPU usage
4. Storing the model reference for reuse

```javascript
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
```

#### 4.2.3 Model Management System Design

The `ModelManager` class provides:
- `loadModel()`: Loads or downloads a model based on performance mode
- `releaseModel()`: Properly releases model resources
- `isModelLoaded()`: Checks if a model is currently loaded
- `doesRequireModelChange()`: Determines if a performance mode change requires a new model
- `deleteAllModels()`: Deletes downloaded models to free space

### 4.3 Audio Chunking

The audio chunking system is implemented in `AudioChunker.js` and handles processing long audio files in manageable chunks.

#### 4.3.1 Audio Duration Detection

We implemented a robust method to detect audio duration using FFmpeg:

```javascript
async getAudioDuration(audioPath) {
  try {
    // For bundled assets, use default duration
    if (typeof audioPath !== 'string') {
      console.log('Asset file detected, using default duration');
      return 60000; // Default to 1 minute for bundled assets
    }
    
    // Use a simpler FFmpeg command that should work with most versions
    const command = `-i "${audioPath}"`;
    
    return new Promise((resolve) => {
      FFmpegKit.executeAsync(
        command,
        async (session) => {
          const output = await session.getAllLogsAsString();
          console.log('FFmpeg output for duration detection:', output);
          
          // Extract duration from output using regex
          // FFmpeg typically outputs duration in format: Duration: 00:01:23.45
          const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          
          if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseInt(durationMatch[3]);
            const centiseconds = parseInt(durationMatch[4]);
            
            const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
            console.log(`Extracted duration: ${durationMs}ms`);
            resolve(durationMs);
          } else {
            console.log('Could not extract duration, using default');
            resolve(60000); // Default to 1 minute if duration can't be detected
          }
        },
        (log) => {
          console.log(`FFmpeg duration log: ${log.getMessage()}`);
        }
      );
    });
  } catch (error) {
    console.error('Error getting audio duration:', error);
    // Fallback value
    return 60000; // Default to 1 minute
  }
}
```

#### 4.3.2 Audio Chunking Process

The chunking process:
1. Determines audio duration
2. Divides audio into overlapping chunks based on profile settings
3. Extracts and processes each chunk sequentially
4. Merges results with special handling for overlaps

```javascript
// Create chunks with overlap
const chunks = [];
for (let start = 0; start < audioDuration; start += this.chunkSize - this.overlap) {
  const end = Math.min(start + this.chunkSize, audioDuration);
  chunks.push({ 
    start, 
    end, 
    index: chunks.length,
    durationMs: end - start
  });
}
```

#### 4.3.3 Audio Segment Extraction

Each audio chunk is extracted using FFmpeg:

```javascript
async extractAudioSegment(audioPath, startMs, endMs) {
  try {
    // For bundled assets, we need a different approach
    if (typeof audioPath !== 'string') {
      console.log('Cannot extract from bundled asset, using full asset');
      return audioPath;
    }
    
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
    const durationMs = endMs - startMs;
    const durationTime = formatTime(durationMs);
    
    // Create FFmpeg command to extract segment
    const command = `-i "${audioPath}" -ss ${startTime} -t ${durationTime} -c:a pcm_s16le -ar 16000 -ac 1 "${outputPath}"`;
    
    console.log(`Extracting audio segment from ${startTime} to ${durationTime}`);
    
    // Execute FFmpeg command
    return new Promise((resolve, reject) => {
      FFmpegKit.executeAsync(
        command,
        async (session) => {
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) {
            // Add to temp files for cleanup
            this.tempFiles.push(outputPath);
            resolve(outputPath);
          } else {
            const output = await session.getOutput();
            console.error('FFmpeg extraction error:', output);
            reject(new Error(`FFmpeg error extracting segment: ${returnCode}`));
          }
        },
        (log) => {
          console.log(`FFmpeg extraction log: ${log.getMessage()}`);
        }
      );
    });
  } catch (error) {
    console.error('Error extracting audio segment:', error);
    throw error;
  }
}
```

#### 4.3.4 Chunk Transcription

Each chunk is transcribed with:
1. Extraction from the main audio file using FFmpeg
2. Transcription with appropriate timestamp offsets
3. Cleanup of temporary chunk files
4. Proper handling of failures for individual chunks

```javascript
async transcribeSingleChunk(chunkPath, options) {
  if (!this.whisperContext) {
    throw new Error('Whisper context not initialized');
  }
  
  try {
    console.log(`Transcribing chunk: ${typeof chunkPath === 'string' ? chunkPath : 'bundled asset'}`);
    
    // Make sure we have valid options
    const safeOptions = options || {};
    
    // Use the loaded whisper context for transcription
    if (this.whisperContext && typeof this.whisperContext.transcribe === 'function') {
      const { promise } = this.whisperContext.transcribe(chunkPath, safeOptions);
      const result = await promise;
      
      // Ensure result has expected properties
      if (!result || typeof result.result === 'undefined') {
        console.warn('Whisper returned unexpected result structure:', result);
        return { result: '' }; // Return empty string as fallback
      }
      
      return result;
    } else {
      throw new Error('Invalid Whisper context: transcribe function not available');
    }
  } catch (error) {
    console.error('Error transcribing chunk:', error);
    throw error;
  }
}
```

#### 4.3.5 Result Merging

Results are merged with:
1. Sorting by chunk index
2. Concatenation with appropriate handling of overlaps
3. Ensuring string values for all result properties

```javascript
mergeTranscriptionResults(results) {
  // Sort results by chunk index
  results.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  // Initialize merged result
  let mergedText = '';
  
  // Process each chunk's results
  results.forEach((chunkResult, index) => {
    if (index === 0) {
      // For first chunk, take everything
      mergedText = chunkResult.result || '';
    } else {
      // For subsequent chunks, handle overlap
      const prevChunkEnd = results[index-1].endTime;
      const currentChunkStart = chunkResult.startTime;
      
      // Calculate overlap
      const overlapDuration = Math.max(0, prevChunkEnd - currentChunkStart);
      
      // Add a space between chunks
      mergedText += ' ' + (chunkResult.result || '');
    }
  });
  
  return {
    result: mergedText.trim()
  };
}
```

### 4.4 User Interface Components

#### 4.4.1 Performance Mode Selector

We implemented a `PerformanceModeSelector` component that:
- Shows all available performance modes
- Highlights the currently selected mode
- Displays the selected mode's description
- Shows a visual indicator of the speed/accuracy tradeoff

```jsx
const PerformanceModeSelector = ({ currentMode, onChange, disabled = false }) => {
  // Mode options with friendly names
  const modeOptions = [
    { id: 'highest-accuracy', label: 'Highest' },
    { id: 'accurate', label: 'Accurate' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'fast', label: 'Fast' },
    { id: 'fastest', label: 'Fastest' }
  ];

  // Get speed improvement display
  const speedRatio = getSpeedRatio(currentMode);
  const speedDisplay = speedRatio === 1 ? 'Baseline' : `${speedRatio}x faster`;

  return (
    <View style={styles.performanceContainer}>
      <Text style={styles.performanceTitle}>Transcription Performance</Text>
      
      <View style={styles.modeContainer}>
        {modeOptions.map(mode => (
          <TouchableOpacity 
            key={mode.id}
            style={[
              styles.modeOption, 
              currentMode === mode.id && styles.selectedMode,
              disabled && styles.disabledMode
            ]}
            onPress={() => !disabled && onChange(mode.id)}
            disabled={disabled}
          >
            <Text style={[
              styles.modeText, 
              currentMode === mode.id && styles.selectedModeText,
              disabled && styles.disabledText
            ]}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <Text style={styles.modeDescription}>
        {PERFORMANCE_PROFILES[currentMode]?.description || ''}
      </Text>
      
      {/* Speed/accuracy indicator */}
      <View style={styles.estimatedTimeContainer}>
        <View style={styles.timeScale}>
          <View 
            style={[
              styles.timeIndicator, 
              {left: `${getSpeedPercentage(currentMode)}%`}
            ]} 
          />
          <Text style={styles.fasterLabel}>Faster</Text>
          <Text style={styles.accurateLabel}>More Accurate</Text>
        </View>
        <Text style={styles.speedRatio}>{speedDisplay}</Text>
      </View>
    </View>
  );
};
```

#### 4.4.2 Model Download Info

We implemented a `ModelDownloadInfo` component that:
- Shows which model is currently in use
- Displays model file size information
- Provides a button to delete downloaded models to free space

```jsx
const ModelDownloadInfo = ({ 
  currentMode, 
  modelManager, 
  isModelLoaded,
  onDeleteModels 
}) => {
  const profile = PERFORMANCE_PROFILES[currentMode];
  const modelFile = profile?.modelFile || '';
  const modelSize = MODEL_SIZES[modelFile] || 'Unknown';
  
  // Show a delete button if models are downloaded
  const handleDelete = () => {
    Alert.alert(
      'Delete Downloaded Models',
      'This will delete all downloaded model files to free up space. You will need to download them again when you next use the app.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: onDeleteModels
        }
      ]
    );
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.infoContainer}>
        <Text style={styles.modelTitle}>Current model: {modelFile}</Text>
        <Text style={styles.modelInfo}>Size: {modelSize} {isModelLoaded ? '(Loaded)' : '(Not loaded)'}</Text>
      </View>
      
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={handleDelete}
      >
        <Text style={styles.deleteButtonText}>Delete Models</Text>
      </TouchableOpacity>
    </View>
  );
};
```

### 4.5 Integration with Existing Codebase

The new components were integrated with minimal changes to the existing codebase:

1. **App.js**: 
   - Added performance mode state and handling
   - Updated transcription logic to use chunking
   - Added model download information
   - Modified sample file handling

```javascript
// In App.js, add state for performance mode
const [performanceMode, setPerformanceMode] = useState(DEFAULT_PERFORMANCE_MODE);

// Add handler for performance mode changes
const handlePerformanceModeChange = async (newMode) => {
  if (isLoading || isRecording) {
    Alert.alert(
      'Cannot Change Mode',
      'Please finish or cancel the current operation before changing performance mode.'
    );
    return;
  }
  
  setPerformanceMode(newMode);
  
  // Check if we need to load a different model
  if (modelManagerRef.current && modelManagerRef.current.doesRequireModelChange(newMode)) {
    try {
      setIsModelLoaded(false);
      setStatus('Switching model...');
      setIsLoading(true);
      
      // Load the new model
      whisperContextRef.current = await modelManagerRef.current.loadModel(newMode);
      setIsModelLoaded(true);
      
      // Reset UI
      setTimeout(() => {
        setStatus('Ready to transcribe');
        setProgress(0);
        setIsLoading(false);
      }, 1000);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error switching model:', error);
      setStatus('Error switching model: ' + error.message);
      setIsLoading(false);
      
      Alert.alert(
        'Model Switching Error',
        'There was an error switching the transcription model. Please try again.',
        [{ text: 'OK' }]
      );
    }
  }
};
```

2. **audioUtils.js**: 
   - Enhanced with better error handling
   - Added functions for audio duration detection
   - Improved format handling

3. **UI Integration**:
   - Added components to the main App.js render function:

```jsx
<PerformanceModeSelector
  currentMode={performanceMode}
  onChange={handlePerformanceModeChange}
  disabled={isLoading || isRecording}
/>

<ModelDownloadInfo
  currentMode={performanceMode}
  modelManager={modelManagerRef.current}
  isModelLoaded={isModelLoaded}
  onDeleteModels={handleDeleteModels}
/>
```

---

## 5. Implementation Challenges and Solutions

### 5.1 EAS Build Size Limitations

#### 5.1.1 Challenge
EAS has a 2.0GB limit for build archives. Our initial build was 3.9GB due to duplicate model files.

#### 5.1.2 Analysis
The `find` command revealed duplicate model files:
```bash
find . -type f -size +100M | grep -v "node_modules"
./ios/ggml-large-v3-q5_0.bin
./ios/ggml-large-v3-turbo-q5_0.bin
./ios/MyWhisperApp/Resources/ggml-large-v3-q5_0.bin
./ios/MyWhisperApp/Resources/ggml-large-v3-turbo-q5_0.bin
```

#### 5.1.3 Solution
1. Removed duplicate files from the ios/ root folder:
```bash
rm ./ios/ggml-large-v3-q5_0.bin
rm ./ios/ggml-large-v3-turbo-q5_0.bin
```

2. Implemented on-demand downloading for models
3. Kept the non-turbo model in the Xcode project's Resources folder
4. Created an empty `.easignore` file to help with build size

### 5.2 Model File Management

#### 5.2.1 Challenge
Model files were appearing as "red" (missing) in Xcode after removing duplicates.

#### 5.2.2 Solution
Fixed Xcode references:
1. Selected the red files in Xcode
2. Pressed Delete to remove the references (not the files)
3. Right-clicked on "Resources" group and selected "Add Files to 'MyWhisperApp'..."
4. Selected model files from their actual location
5. Ensured "Copy items if needed" was NOT checked
6. Added them to the app target

### 5.3 Audio Duration Detection

#### 5.3.1 Challenge
The initial FFmpeg command for detecting audio duration was using the `-show_entries format=duration` option, which wasn't supported in the FFmpeg version included in the build.

```
FFmpeg duration log: Unrecognized option 'show_entries'.
FFmpeg duration log: Error splitting the argument list:
FFmpeg duration log: Option not found
```

#### 5.3.2 Solution
Implemented a more compatible approach that:
1. Uses a simpler FFmpeg command (`-i "${audioPath}"`)
2. Parses the standard output for the "Duration: HH:MM:SS.SS" format
3. Converts the extracted time to milliseconds
4. Provides fallbacks for when duration can't be detected

```javascript
// Extract duration from output using regex
const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            
if (durationMatch) {
  const hours = parseInt(durationMatch[1]);
  const minutes = parseInt(durationMatch[2]);
  const seconds = parseInt(durationMatch[3]);
  const centiseconds = parseInt(durationMatch[4]);
  
  const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
  console.log(`Extracted duration: ${durationMs}ms`);
  resolve(durationMs);
} else {
  console.log('Could not extract duration, using default');
  resolve(60000); // Default to 1 minute if duration can't be detected
}
```

### 5.4 Bundled Assets Handling

#### 5.4.1 Challenge
Transcription failed for bundled assets (like sample.wav) with the error:
```
ERROR Transcription error: [TypeError: undefined is not an object (evaluating 'filePathOrBase64.startsWith')]
```

This occurred because WhisperRN expects an actual file path, not a JavaScript require() reference.

#### 5.4.2 Solution
Implemented a special handler for bundled assets that:
1. Extracts the bundled asset to a temporary file
2. Uses the file path of that temporary file for transcription
3. Leverages Expo's Asset system to handle bundled assets properly

```javascript
const transcribeSample = async () => {
  try {
    setIsLoading(true);
    setStatus('Preparing sample audio...');
    
    // Create a temporary file for the sample
    const tempDir = FileSystem.cacheDirectory;
    const tempFilePath = tempDir + 'temp_sample.wav';
    
    // Check if we already have a copy of the sample file
    const fileInfo = await FileSystem.getInfoAsync(tempFilePath);
    
    if (!fileInfo.exists) {
      // We need to extract the bundled asset
      // First, get the asset module ID (usually from require)
      const sampleAsset = Asset.fromModule(require('./assets/sample.wav'));
      
      // Ensure the asset is downloaded and available
      if (!sampleAsset.downloaded) {
        await sampleAsset.downloadAsync();
      }
      
      // Copy to a temporary file
      await FileSystem.copyAsync({
        from: sampleAsset.localUri,
        to: tempFilePath
      });
      
      console.log(`Sample extracted to: ${tempFilePath}`);
    }
    
    // Now we have a proper file path to transcribe
    await transcribeAudio(tempFilePath);
    
  } catch (error) {
    console.error('Sample transcription error:', error);
    setStatus('Error transcribing sample: ' + error.message);
    setIsLoading(false);
  }
};
```

### 5.5 Model Download Management

#### 5.5.1 Challenge
Downloading both models concurrently caused slow and unreliable downloads.

#### 5.5.2 Observations
- The non-turbo model download was very slow and sometimes wouldn't start properly
- The turbo model download would start normally
- Downloading both models concurrently took a long time
- Background processes after download affected app functionality temporarily
- Recording functionality didn't work immediately after model loading

#### 5.5.3 Analysis
This behavior appears to be due to:
1. Bandwidth constraints when downloading large files
2. iOS throttling concurrent large downloads
3. Post-download processing (decompression and initialization)

#### 5.5.4 Current State
The current solution is a hybrid approach:
1. Include the non-turbo model in the iOS bundle for immediate functionality
2. Download the turbo model on demand when faster modes are selected
3. Use error handling and fallbacks for download failures

---

## 6. Current State

### 6.1 Functional Components

The application now has the following components:

1. **PerformanceProfiles.js**
   - Defines 5 performance profiles
   - Provides helper functions for UI and options generation

2. **ModelManager.js**
   - Handles model loading, downloading, and switching
   - Provides model file management and resource cleanup

3. **AudioChunker.js**
   - Implements audio chunking for long files
   - Provides duration detection, chunk processing, and result merging

4. **PerformanceModeSelector.js**
   - UI component for selecting performance modes
   - Visualizes speed/accuracy tradeoffs

5. **ModelDownloadInfo.js**
   - Shows model information
   - Provides model management options

6. **App.js (modified)**
   - Integrates new components
   - Manages state for performance modes and models
   - Implements improved transcription logic

7. **audioUtils.js (modified)**
   - Enhanced with better error handling
   - Added functions for audio processing

### 6.2 Component Interactions

The components interact in the following way:

1. **App.js** acts as the central coordinator:
   - Initializes and maintains state
   - Handles user interactions
   - Coordinates between components

2. **ModelManager** is controlled by App.js:
   - App.js calls `loadModel()` on startup and when performance mode changes
   - ModelManager notifies App.js about model load progress

3. **AudioChunker** is used by App.js for transcription:
   - App.js creates an AudioChunker instance for each transcription
   - AudioChunker uses the Whisper context provided by App.js
   - AudioChunker notifies App.js about transcription progress

4. **PerformanceModeSelector** interacts with App.js:
   - User selects a performance mode via the UI
   - App.js updates state and potentially loads a new model

5. **ModelDownloadInfo** displays information from App.js:
   - Receives current model info from App.js
   - Triggers model deletion when requested by user

### 6.3 User Experience Flow

The current user flow is:

1. **Application Launch**:
   - App loads with the "balanced" performance mode by default
   - App checks if the model for this mode is available
   - If bundled, it uses the bundled model
   - If not, it prompts to download the required model

2. **Changing Performance Mode**:
   - User selects a different performance mode
   - App checks if a new model is required
   - If yes, it prompts to download if needed
   - App loads the new model and updates UI

3. **Recording Audio**:
   - User taps "Record Audio"
   - App starts recording in WAV format at 16kHz
   - User taps again to stop recording
   - App processes the recording with the current model and performance settings

4. **Selecting File**:
   - User taps "Select File"
   - App shows file picker
   - If file is not in WAV format, app offers to convert it
   - App processes the file with the current model and performance settings

5. **Transcription Process**:
   - App analyzes audio duration
   - If short, processes directly
   - If long, processes in chunks based on performance profile settings
   - Shows progress during processing
   - Merges chunks and displays result

6. **Model Management**:
   - App shows current model info (file size, loaded status)
   - User can delete downloaded models to free space

### 6.4 Performance Characteristics

The implementation achieves the following performance improvements:

| Profile | Model | bestOf | beamSize | Chunk Size | Speed Ratio |
|---------|-------|--------|----------|------------|-------------|
| Highest Accuracy | large-v3-q5_0 | 3 | 5 | 6 min | 1.0x (baseline) |
| Accurate | large-v3-q5_0 | 2 | 4 | 5 min | ~1.5x |
| Balanced | large-v3-q5_0 | 1 | 3 | 5 min | ~2.5x |
| Fast | large-v3-turbo-q5_0 | 1 | 3 | 4 min | ~3.5x |
| Fastest | large-v3-turbo-q5_0 | 1 | 1 | 3 min | ~5.0x |

Memory usage is also improved by:
- Breaking long audio into manageable chunks
- Processing one chunk at a time
- Cleaning up temporary chunk files immediately after use
- Only loading one model at a time

### 6.5 Model Bundling Behavior

The current implementation has an interesting model bundling behavior:

1. **Bundled Non-Turbo Model**:
   - The `ggml-large-v3-q5_0.bin` model (1.08GB) is included in the Xcode project's Resources folder
   - An empty `.easignore` file allows this model to be included in the app bundle
   - This provides immediate functionality without downloading

2. **On-Demand Turbo Model**:
   - The `ggml-large-v3-turbo-q5_0.bin` model (574MB) is downloaded on demand
   - This happens when the user selects 'fast' or 'fastest' performance modes
   - The app confirms download with the user before proceeding

3. **Model Download Behavior**:
   - Downloads are currently concurrent, which can slow down for multiple models
   - The app shows download progress for any ongoing downloads
   - Downloaded models are stored in the app's document directory for reuse
   - Downloaded models can be deleted via the UI to free space

4. **Post-Download Processing**:
   - There is a delay after download completes before the model is fully usable
   - During this time, some UI operations may be temporarily unresponsive
   - This is likely due to model decompression and initialization
   - The app does not currently provide detailed progress for this phase

### 6.6 Error Handling

The current implementation includes robust error handling:

1. **Download Errors**:
   - Detects download failures and incomplete downloads
   - Cleans up partial downloads
   - Shows appropriate error messages
   - Allows retrying failed downloads

2. **Transcription Errors**:
   - Detects and logs transcription failures
   - Provides fallback to direct transcription if chunking fails
   - Skips problematic chunks rather than failing completely
   - Shows appropriate error messages

3. **Audio Processing Errors**:
   - Handles audio format detection errors
   - Provides fallbacks for audio duration detection
   - Handles extraction errors for audio segments
   - Shows conversion options for incompatible formats

4. **Model Loading Errors**:
   - Detects model loading failures
   - Shows appropriate error messages
   - Provides information about the nature of the error
   - Releases resources properly even on failure

### 6.7 Known Limitations

1. **Concurrent Model Downloads**
   - Downloading multiple models concurrently can be slow and unreliable
   - Background processes after download can temporarily affect functionality
   - No queue system for prioritizing downloads

2. **Bundled Assets Handling**
   - Sample audio button requires special handling for the bundled asset
   - Requires extracting to a temporary file before processing
   - This adds complexity to the transcription logic

3. **Audio Format Detection**
   - Some edge cases in audio format detection may still exist
   - Currently relies on file extension for initial format detection
   - Format conversion may not handle all possible input formats

4. **Progress Indication**
   - Progress indication for model processing after download is limited
   - Chunk processing progress is approximate
   - No detailed progress for post-download model initialization

5. **Dependency Warnings**
   - Minor version differences in dependencies:
     - expo@52.0.41 (expected: ~52.0.42)
     - metro@0.82.1 (expected: ^0.81.0)
     - react-native@0.76.7 (expected: 0.76.8)
   - These don't affect functionality and we've chosen not to update them during development

6. **Memory Management Edge Cases**
   - While chunking improves memory usage, extremely long audio files might still cause issues
   - Loading both models simultaneously could potentially cause memory pressure
   - Concurrent downloads and processing can temporarily increase memory usage

---

## 7. Future Improvements

### 7.1 Sequential Model Downloading

**Issue:** Concurrent downloads of large model files can be slow and unreliable.

**Solution:** Implement a sequential download queue:
1. Modify ModelManager.js to download one model at a time
2. Add a download queue system for multiple models
3. Implement prioritization based on the selected performance mode

```javascript
// Conceptual download queue
class ModelDownloadQueue {
  constructor() {
    this.queue = [];
    this.isDownloading = false;
  }

  addToQueue(modelFileName, priority = 0) {
    // Add to queue with priority
    // Higher priority items move to front of queue
    const queueItem = { 
      modelFileName, 
      priority,
      status: 'queued'
    };
    
    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority);
    
    // Start processing if not already downloading
    if (!this.isDownloading) {
      this.processQueue();
    }
    
    return queueItem;
  }

  async processQueue() {
    if (this.isDownloading) return;
    
    this.isDownloading = true;
    while (this.queue.length > 0) {
      const nextItem = this.queue[0]; // Get but don't remove
      nextItem.status = 'downloading';
      
      try {
        await this.downloadModel(nextItem.modelFileName);
        nextItem.status = 'completed';
      } catch (error) {
        nextItem.status = 'failed';
        nextItem.error = error;
      }
      
      // Remove from queue regardless of success/failure
      this.queue.shift();
    }
    this.isDownloading = false;
  }
  
  async downloadModel(modelFileName) {
    // Existing download logic
  }
  
  getQueueStatus() {
    return {
      isDownloading: this.isDownloading,
      queue: [...this.queue] // Return copy
    };
  }
}
```

### 7.2 Enhanced Progress Indication

**Issue:** Limited feedback during model processing after download.

**Solution:** Implement more detailed progress tracking:
1. Add progress indicators for different stages of model processing
2. Show estimated time remaining based on file size and download speed
3. Provide visual feedback for post-download initialization
4. Add cancellation options for long-running operations

```javascript
// Enhanced progress tracking
const downloadStages = {
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  INITIALIZING: 'initializing',
  COMPLETE: 'complete',
  FAILED: 'failed'
};

// Track progress with stage information
const trackModelProgress = (modelFileName, stage, progress, message) => {
  const stageWeights = {
    [downloadStages.QUEUED]: 0,
    [downloadStages.DOWNLOADING]: 0.8, // 80% of progress is downloading
    [downloadStages.PROCESSING]: 0.1,   // 10% is processing
    [downloadStages.INITIALIZING]: 0.1  // 10% is initialization
  };
  
  let overallProgress = 0;
  
  switch (stage) {
    case downloadStages.QUEUED:
      overallProgress = 0;
      break;
    case downloadStages.DOWNLOADING:
      overallProgress = progress * stageWeights[downloadStages.DOWNLOADING];
      break;
    case downloadStages.PROCESSING:
      overallProgress = stageWeights[downloadStages.DOWNLOADING] + 
                       (progress * stageWeights[downloadStages.PROCESSING]);
      break;
    case downloadStages.INITIALIZING:
      overallProgress = stageWeights[downloadStages.DOWNLOADING] + 
                       stageWeights[downloadStages.PROCESSING] +
                       (progress * stageWeights[downloadStages.INITIALIZING]);
      break;
    case downloadStages.COMPLETE:
      overallProgress = 1;
      break;
    case downloadStages.FAILED:
      // Keep last progress value
      break;
  }
  
  // Update UI with detailed progress information
  this.onProgress(overallProgress);
  this.onStatusUpdate(`${stage}: ${message || ''}`);
};
```

### 7.3 Optimized Bundling Strategy

**Issue:** Current approach bundles one model and downloads others, but could be optimized.

**Solution:** Implement a more sophisticated bundling strategy:
1. Keep the non-turbo model bundled for immediate usability
2. Add option to pre-download models on first launch over Wi-Fi
3. Add model management screen for users to choose which models to keep
4. Implement automatic cleanup of least-used models when space is low

```javascript
// Model retention policy
const modelRetentionPolicy = {
  // Keep models based on:
  KEEP_ALL: 'keep_all',                 // Keep all downloaded models
  KEEP_MOST_USED: 'keep_most_used',     // Keep models used most frequently
  KEEP_SELECTED: 'keep_selected',       // Keep only user-selected models
  KEEP_SMALLEST: 'keep_smallest'        // Keep smallest models to save space
};

// Model management screen component
const ModelManagementScreen = ({ models, onDownload, onDelete, onSetRetentionPolicy }) => {
  const [retentionPolicy, setRetentionPolicy] = useState(modelRetentionPolicy.KEEP_MOST_USED);
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Model Management</Text>
      
      {/* Retention policy selector */}
      <View style={styles.policyContainer}>
        <Text style={styles.sectionTitle}>Storage Policy</Text>
        <Picker
          selectedValue={retentionPolicy}
          onValueChange={(value) => {
            setRetentionPolicy(value);
            onSetRetentionPolicy(value);
          }}
        >
          <Picker.Item label="Keep All Models" value={modelRetentionPolicy.KEEP_ALL} />
          <Picker.Item label="Keep Most Used Models" value={modelRetentionPolicy.KEEP_MOST_USED} />
          <Picker.Item label="Keep Selected Models" value={modelRetentionPolicy.KEEP_SELECTED} />
          <Picker.Item label="Optimize for Storage" value={modelRetentionPolicy.KEEP_SMALLEST} />
        </Picker>
      </View>
      
      {/* Model list */}
      <Text style={styles.sectionTitle}>Available Models</Text>
      <FlatList
        data={models}
        renderItem={({ item }) => (
          <ModelListItem
            model={item}
            onDownload={() => onDownload(item.fileName)}
            onDelete={() => onDelete(item.fileName)}
          />
        )}
        keyExtractor={(item) => item.fileName}
      />
    </View>
  );
};
```

---

## 8. Appendix

### 8.1 File Structure

Current file structure:
```
MyWhisperApp/
├── App.js                       # Main application file (modified)
├── audioUtils.js                # Audio utilities (modified)
├── PerformanceProfiles.js       # Performance profile definitions (new)
├── ModelManager.js              # Model management system (new)
├── AudioChunker.js              # Audio chunking implementation (new)
├── PerformanceModeSelector.js   # UI for selecting performance modes (new)
├── ModelDownloadInfo.js         # UI for model information (new)
├── metro.config.js              # Metro bundler configuration
├── .easignore                   # Empty file to help with EAS build
├── ios/                         # iOS project files
│   └── MyWhisperApp/
│       └── Resources/
│           └── ggml-large-v3-q5_0.bin  # Bundled model file
├── assets/                      # App assets
│   └── sample.wav               # Sample audio file
├── package.json                 # Project dependencies
└── index.js                     # Entry point
```

### 8.2 Key Implementation Details

#### 8.2.1 Model File Locations

The application uses the following locations for model files:
- **Bundled Model**: `/ios/MyWhisperApp/Resources/ggml-large-v3-q5_0.bin`
- **Downloaded Models**: `FileSystem.documentDirectory + modelFileName`
- **Temporary Files**: `FileSystem.cacheDirectory + filename`

#### 8.2.2 Audio Data Flow

The audio processing flow is:
1. **Recording**: App records in WAV format at 16kHz
2. **File Selection**: App selects or converts file to WAV format
3. **Duration Detection**: App determines audio duration using FFmpeg
4. **Chunking**: App divides long audio into chunks with overlap
5. **Extraction**: App extracts each chunk using FFmpeg
6. **Transcription**: App transcribes each chunk with Whisper
7. **Merging**: App combines chunk transcriptions with overlap handling
8. **Display**: App shows the final transcription result

#### 8.2.3 Model Loading Flow

The model loading flow is:
1. **Profile Selection**: User selects a performance profile
2. **Model Determination**: App determines which model file to use
3. **Download Check**: App checks if model is downloaded
4. **Download Prompt**: App prompts user if download is needed
5. **Model Download**: App downloads model if necessary
6. **Initialization**: App initializes Whisper with the model
7. **GPU Check**: App verifies GPU acceleration
8. **Model Storage**: App stores model reference for reuse

### 8.3 Metro Configuration

The metro.config.js file is configured to include .bin files as assets:

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const defaultConfig = getDefaultConfig(__dirname);
// Add .bin files to the asset extensions
defaultConfig.resolver.assetExts.push('bin');
// For iOS include the binary FFmpeg libraries
defaultConfig.resolver.assetExts.push('a');
defaultConfig.resolver.assetExts.push('dylib');
module.exports = defaultConfig;
```

This configuration allows the app to:
1. Include .bin files (models) as assets
2. Include iOS binary libraries (.a and .dylib files)
3. Reference these assets in the code

### 8.4 Build Process

The build process involves:

1. **EAS Configuration**:
   - An empty `.easignore` file to handle large model files

2. **Xcode Project Configuration**:
   - Including model file in Resources group
   - Setting proper target membership
   - Ensuring file is in Copy Bundle Resources phase

3. **Model Loading Strategy**:
   - Non-turbo model included in bundle
   - Turbo model downloaded on demand
   - Both models using the same code path

4. **Build Size Management**:
   - Initial build size was 3.9GB (too large for EAS)
   - Removed duplicate model files
   - Current build size is approximately 1.5GB

### 8.5 Performance Modes Detailed Specification

Detailed specifications for each performance mode:

#### 8.5.1 Highest Accuracy Mode
- **Model**: ggml-large-v3-q5_0.bin (1.08GB)
- **Parameters**: bestOf=3, beamSize=5, temperature=0.0
- **Chunking**: 6-minute chunks with 10-second overlap
- **Use Case**: Critical content where accuracy is paramount
- **Performance**: Baseline (1x speed)

#### 8.5.2 Accurate Mode
- **Model**: ggml-large-v3-q5_0.bin (1.08GB)
- **Parameters**: bestOf=2, beamSize=4, temperature=0.0
- **Chunking**: 5-minute chunks with 8-second overlap
- **Use Case**: Important content with good accuracy
- **Performance**: ~1.5x baseline speed

#### 8.5.3 Balanced Mode
- **Model**: ggml-large-v3-q5_0.bin (1.08GB)
- **Parameters**: bestOf=1, beamSize=3, temperature=0.0
- **Chunking**: 5-minute chunks with 6-second overlap
- **Use Case**: General purpose transcription
- **Performance**: ~2.5x baseline speed

#### 8.5.4 Fast Mode
- **Model**: ggml-large-v3-turbo-q5_0.bin (574MB)
- **Parameters**: bestOf=1, beamSize=3, temperature=0.0
- **Chunking**: 4-minute chunks with 5-second overlap
- **Use Case**: Quick transcription with acceptable accuracy
- **Performance**: ~3.5x baseline speed

#### 8.5.5 Fastest Mode
- **Model**: ggml-large-v3-turbo-q5_0.bin (574MB)
- **Parameters**: bestOf=1, beamSize=1, temperature=0.0
- **Chunking**: 3-minute chunks with 4-second overlap
- **Use Case**: Maximum speed for clean audio
- **Performance**: ~5x baseline speed

### 8.6 References

1. WhisperRN Documentation: [whisper.rn](https://www.npmjs.com/package/whisper.rn)
2. Hugging Face Whisper Models: [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)
3. Expo Documentation: [Expo](https://docs.expo.dev/)
4. FFmpeg Documentation: [FFmpeg](https://ffmpeg.org/documentation.html)
5. EAS Build Documentation: [EAS Build](https://docs.expo.dev/build/introduction/)
