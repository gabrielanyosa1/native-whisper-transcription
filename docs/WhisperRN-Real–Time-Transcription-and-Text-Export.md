# WhisperRN Real-Time Transcription and Text Export
## Design Document

**Author:** Gabriel Anyosa
**Date:** April 1, 2025  
**Status:** Draft  
**Document Version:** 1.0  

## Table of Contents
1. [Overview](#1-overview)
2. [Real-Time Transcription Design](#2-real-time-transcription-design)
   - [2.1 System Architecture](#21-system-architecture)
   - [2.2 Audio Stream Processing](#22-audio-stream-processing)
   - [2.3 Performance Profiles for Real-Time](#23-performance-profiles-for-real-time)
   - [2.4 UI/UX Considerations](#24-uiux-considerations)
   - [2.5 Implementation Strategy](#25-implementation-strategy)
3. [Text Export Feature Design](#3-text-export-feature-design)
   - [3.1 Export Options](#31-export-options)
   - [3.2 File System Operations](#32-file-system-operations)
   - [3.3 UI/UX Design](#33-uiux-design)
   - [3.4 Implementation Strategy](#34-implementation-strategy)
4. [Implementation Details](#4-implementation-details)
   - [4.1 Real-Time Transcription Implementation](#41-real-time-transcription-implementation)
   - [4.2 Text Export Implementation](#42-text-export-implementation)
5. [Performance Considerations](#5-performance-considerations)
6. [Testing Strategy](#6-testing-strategy)
7. [Risk Assessment](#7-risk-assessment)

---

## 1. Overview

This design document focuses on two specific features to be added to the WhisperRN iOS application:

1. **Real-Time Transcription:** Enabling streaming audio transcription with live feedback
2. **Text Export:** Allowing users to export transcription results as .txt files

These features build upon the existing WhisperRN implementation with performance optimizations already in place.

---

## 2. Real-Time Transcription Design

### 2.1 System Architecture

The real-time transcription feature will use the `transcribeRealtime` method provided by WhisperRN, which handles audio recording and processing in streaming chunks. The architecture consists of:

1. **Audio Capture Component:** Handles microphone access and audio streaming
2. **Stream Processing Component:** Processes audio chunks in real-time
3. **Real-Time Transcription Engine:** Uses WhisperRN's real-time capabilities
4. **Display Component:** Shows live transcription results with proper formatting

The system will operate in a non-blocking manner, with audio processing happening on a background thread while UI updates occur on the main thread.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Audio Capture  │────▶│ Stream Process  │────▶│ Whisper Engine  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   UI Updates    │◀────│  Text Processor │◀────│ Result Handler  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 2.2 Audio Stream Processing

WhisperRN's `transcribeRealtime` method handles the complexities of streaming audio processing:

1. **Audio Segmentation:** Captures audio in configurable segments (default 3 seconds)
2. **Segment Overlap:** Uses overlapping segments for continuity
3. **VAD (Voice Activity Detection):** Can be enabled to reduce processing of silence
4. **Incremental Processing:** Processes and returns results incrementally

Key configuration parameters:

```javascript
const realtimeOptions = {
  language: 'auto',              // Automatic language detection
  realtimeAudioSec: 3,           // Length of audio segment to buffer
  realtimeAudioSliceSec: 1.5,    // Length of audio processing step
  useVad: true,                  // Voice activity detection
  vadThold: 0.6,                 // VAD threshold
  vadFreqThold: 100,             // VAD frequency threshold
  maxThreads: 6,                 // Thread utilization
  beamSize: 1,                   // Reduced beam size for real-time
  audioOutputPath: null,         // Optional recording path
};
```

### 2.3 Performance Profiles for Real-Time

Real-time transcription requires different performance profiles than batch processing:

| Profile | Description | Key Parameters | Use Case |
|---------|-------------|----------------|----------|
| Real-Time High Quality | Balanced accuracy with minimal latency | beamSize: 3, realtimeAudioSec: 3.0 | Interviews, detailed meetings |
| Real-Time Standard | Good accuracy with low latency | beamSize: 1, realtimeAudioSec: 2.5 | General dictation, meetings |
| Real-Time Fast | Maximum speed, acceptable accuracy | beamSize: 1, realtimeAudioSec: 2.0, turbo model | Quick notes, drafting |

Each profile will utilize the turbo model variant for better real-time performance.

### 2.4 UI/UX Considerations

The real-time transcription UI will focus on:

1. **Live Feedback:** Text appears as it's transcribed with minimal latency
2. **Visual Indicators:** Microphone animation shows active recording
3. **Confidence Visualization:** Visual indication of transcription confidence
4. **Pause/Resume:** Allow users to pause and resume transcription
5. **Error Recovery:** Graceful handling of temporary recognition errors

Example UI component structure:

```jsx
<SafeAreaView style={styles.container}>
  {/* Status and control header */}
  <View style={styles.header}>
    <Text style={styles.statusText}>{status}</Text>
    <TouchableOpacity
      style={[styles.controlButton, isRecording ? styles.stopButton : styles.startButton]}
      onPress={isRecording ? stopRealTimeTranscription : startRealTimeTranscription}
    >
      <Text style={styles.buttonText}>
        {isRecording ? "Stop" : "Start"}
      </Text>
    </TouchableOpacity>
  </View>
  
  {/* Live transcription display */}
  <View style={styles.transcriptionContainer}>
    <ScrollView 
      ref={scrollViewRef}
      style={styles.transcriptionScroll}
      contentContainerStyle={styles.transcriptionContent}
    >
      {renderFormattedTranscription()}
      
      {/* Blinking cursor at end when active */}
      {isRecording && <View style={[styles.cursor, cursorVisible && styles.visibleCursor]} />}
    </ScrollView>
  </View>
  
  {/* Action buttons */}
  <View style={styles.actionButtons}>
    <TouchableOpacity 
      style={[styles.actionButton, styles.exportButton]}
      onPress={handleExportTranscription}
      disabled={!transcriptionText.trim()}
    >
      <Text style={styles.actionButtonText}>Export</Text>
    </TouchableOpacity>
    
    <TouchableOpacity 
      style={[styles.actionButton, styles.clearButton]}
      onPress={handleClearTranscription}
      disabled={!transcriptionText.trim()}
    >
      <Text style={styles.actionButtonText}>Clear</Text>
    </TouchableOpacity>
  </View>
</SafeAreaView>
```

### 2.5 Implementation Strategy

The implementation will follow these steps:

1. **Audio Session Configuration:**
   ```javascript
   // Configure iOS audio session for recording
   await AudioSessionIos.setCategory(
     AudioSessionIos.Category.PlayAndRecord,
     [AudioSessionIos.CategoryOption.DefaultToSpeaker]
   );
   await AudioSessionIos.setMode(AudioSessionIos.Mode.Default);
   await AudioSessionIos.setActive(true);
   ```

2. **Initialize Real-Time Transcription:**
   ```javascript
   const startRealTimeTranscription = async () => {
     try {
       setIsRecording(true);
       setStatus('Listening...');
       
       // Get the current profile settings
       const profile = realtimeProfiles[realtimeMode]; 
       
       // Start real-time transcription
       const { stop: stopFn, subscribe } = await whisperContextRef.current.transcribeRealtime({
         ...profile,
         language: 'auto',
         useVad: true,
         audioOutputPath: `${FileSystem.cacheDirectory}last_recording.wav`
       });
       
       // Store stop function for later use
       stopTranscriptionRef.current = stopFn;
       
       // Subscribe to transcription updates
       subscribe(handleTranscriptionEvent);
       
     } catch (error) {
       console.error('Real-time transcription error:', error);
       setIsRecording(false);
       setStatus('Error starting transcription');
       Alert.alert('Transcription Error', error.message);
     }
   };
   ```

3. **Handle Transcription Events:**
   ```javascript
   const handleTranscriptionEvent = (event) => {
     const { isCapturing, data, processTime, recordingTime } = event;
     
     // Update UI with latest transcription
     if (data && data.result) {
       setTranscriptionText(data.result);
       
       // Auto-scroll to bottom of text
       if (scrollViewRef.current) {
         setTimeout(() => {
           scrollViewRef.current.scrollToEnd({ animated: true });
         }, 100);
       }
     }
     
     // Update status with processing information
     setStatus(`Listening... (Process: ${Math.round(processTime)}ms)`);
     
     // Handle end of transcription
     if (!isCapturing) {
       setIsRecording(false);
       setStatus('Transcription complete');
       stopTranscriptionRef.current = null;
     }
   };
   ```

4. **Stop Transcription:**
   ```javascript
   const stopRealTimeTranscription = async () => {
     try {
       if (stopTranscriptionRef.current) {
         await stopTranscriptionRef.current();
         stopTranscriptionRef.current = null;
       }
       
       setIsRecording(false);
       setStatus('Transcription stopped');
       
       // Reset audio session
       await AudioSessionIos.setActive(false);
       
     } catch (error) {
       console.error('Error stopping transcription:', error);
       setStatus('Error stopping transcription');
     }
   };
   ```

---

## 3. Text Export Feature Design

### 3.1 Export Options

The text export feature will provide the following options:

1. **Format Options:**
   - Plain text (.txt)
   - Future extension: Support for other formats (e.g., .srt, .vtt)
   
2. **Content Options:**
   - Full transcription
   - With or without timestamps
   - With or without speaker labels (if available)

3. **Naming Options:**
   - Default: "Transcription_[DATE]_[TIME].txt"
   - User-defined filename

### 3.2 File System Operations

The export process will use React Native's FileSystem API to:

1. Write the transcription to a temporary file in the app's cache directory
2. Provide sharing options for the generated file
3. Optionally save the file to a user-accessible location

```javascript
// File system paths
const DOCUMENTS_DIR = FileSystem.documentDirectory;
const CACHE_DIR = FileSystem.cacheDirectory;

// Generate a default filename
const getDefaultFilename = () => {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `Transcription_${date}_${time}.txt`;
};
```

### 3.3 UI/UX Design

The export UI will be simple yet functional:

1. **Export Button:** Available when transcription is completed
2. **Export Modal:** Appears when export is initiated, with options for:
   - Filename
   - Format options (plain text only in initial version)
   - Include timestamps option

3. **Share Sheet:** System share sheet for sending the file via email, messages, etc.
4. **Success Confirmation:** Notification when export is successful

```jsx
<Modal
  visible={showExportModal}
  transparent={true}
  animationType="slide"
>
  <View style={styles.modalContainer}>
    <View style={styles.exportModalContent}>
      <Text style={styles.modalTitle}>Export Transcription</Text>
      
      <TextInput
        style={styles.filenameInput}
        value={exportFilename}
        onChangeText={setExportFilename}
        placeholder="Filename"
      />
      
      <View style={styles.optionsContainer}>
        <Text style={styles.optionLabel}>Include timestamps:</Text>
        <Switch
          value={includeTimestamps}
          onValueChange={setIncludeTimestamps}
        />
      </View>
      
      <View style={styles.modalButtons}>
        <TouchableOpacity
          style={[styles.modalButton, styles.cancelButton]}
          onPress={() => setShowExportModal(false)}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.modalButton, styles.exportButton]}
          onPress={handleExportConfirm}
        >
          <Text style={styles.exportButtonText}>Export</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>
```

### 3.4 Implementation Strategy

The export feature will be implemented with these main components:

1. **Export Button** in the main UI that becomes active when transcription is available
2. **Export Modal** for configuring export options
3. **Export Service** for handling file operations
4. **Share Integration** for distributing the exported file

---

## 4. Implementation Details

### 4.1 Real-Time Transcription Implementation

```javascript
// Real-time transcription profiles
const realtimeProfiles = {
  'high-quality': {
    modelFile: 'ggml-large-v3-turbo-q5_0.bin',
    beamSize: 3,
    bestOf: 1,
    realtimeAudioSec: 3.0,
    realtimeAudioSliceSec: 1.5,
    maxThreads: 6,
    temperature: 0.0,
    description: 'High quality real-time transcription with good accuracy'
  },
  'standard': {
    modelFile: 'ggml-large-v3-turbo-q5_0.bin',
    beamSize: 1,
    bestOf: 1,
    realtimeAudioSec: 2.5,
    realtimeAudioSliceSec: 1.2,
    maxThreads: 6,
    temperature: 0.0,
    description: 'Balanced real-time transcription with low latency'
  },
  'fast': {
    modelFile: 'ggml-large-v3-turbo-q5_0.bin',
    beamSize: 1,
    bestOf: 1,
    realtimeAudioSec: 2.0,
    realtimeAudioSliceSec: 1.0,
    maxThreads: 6,
    temperature: 0.0,
    description: 'Fastest real-time transcription with minimal latency'
  }
};

// Component state
const [realtimeMode, setRealtimeMode] = useState('standard');
const [isRecording, setIsRecording] = useState(false);
const [transcriptionText, setTranscriptionText] = useState('');
const [status, setStatus] = useState('Ready');
const [cursorVisible, setCursorVisible] = useState(true);

// Refs
const stopTranscriptionRef = useRef(null);
const scrollViewRef = useRef(null);

// Start blinking cursor effect when recording
useEffect(() => {
  let cursorInterval;
  if (isRecording) {
    cursorInterval = setInterval(() => {
      setCursorVisible(prev => !prev);
    }, 500);
  }
  
  return () => {
    if (cursorInterval) clearInterval(cursorInterval);
  };
}, [isRecording]);

// Main transcription functions
const startRealTimeTranscription = async () => {
  try {
    if (!whisperContextRef.current) {
      await loadWhisperModel(realtimeProfiles[realtimeMode].modelFile);
    }
    
    // Request microphone permission if needed
    const { status: micPermission } = await Audio.requestPermissionsAsync();
    if (micPermission !== 'granted') {
      Alert.alert('Permission Required', 'Microphone access is needed for transcription');
      return;
    }
    
    // Configure audio session
    await AudioSessionIos.setCategory(
      AudioSessionIos.Category.PlayAndRecord,
      [AudioSessionIos.CategoryOption.DefaultToSpeaker]
    );
    await AudioSessionIos.setMode(AudioSessionIos.Mode.Default);
    await AudioSessionIos.setActive(true);
    
    setIsRecording(true);
    setStatus('Listening...');
    
    // Get current profile settings
    const profile = realtimeProfiles[realtimeMode];
    
    // Start real-time transcription
    const { stop: stopFn, subscribe } = await whisperContextRef.current.transcribeRealtime({
      ...profile,
      language: 'auto',
      useVad: true,
      audioOutputPath: `${FileSystem.cacheDirectory}last_recording.wav`
    });
    
    // Store stop function
    stopTranscriptionRef.current = stopFn;
    
    // Subscribe to transcription events
    subscribe(handleTranscriptionEvent);
    
  } catch (error) {
    console.error('Real-time transcription error:', error);
    setIsRecording(false);
    setStatus('Error starting transcription');
    Alert.alert('Transcription Error', error.message);
  }
};

const handleTranscriptionEvent = (event) => {
  try {
    const { isCapturing, data, processTime, recordingTime, slices } = event;
    
    // Handle data updates
    if (data && data.result) {
      setTranscriptionText(data.result);
      
      // Auto-scroll to bottom
      if (scrollViewRef.current) {
        setTimeout(() => {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }, 100);
      }
    }
    
    // Update status with timing information
    if (isCapturing) {
      setStatus(`Listening... (${Math.round(processTime)}ms)`);
    } else {
      setIsRecording(false);
      setStatus('Transcription complete');
      stopTranscriptionRef.current = null;
    }
    
  } catch (error) {
    console.error('Error handling transcription event:', error);
  }
};

const stopRealTimeTranscription = async () => {
  try {
    if (stopTranscriptionRef.current) {
      await stopTranscriptionRef.current();
      stopTranscriptionRef.current = null;
    }
    
    setIsRecording(false);
    setStatus('Transcription stopped');
    
    // Reset audio session
    await AudioSessionIos.setActive(false);
    
  } catch (error) {
    console.error('Error stopping transcription:', error);
    setStatus('Error stopping transcription');
  }
};

// Format transcription with proper line breaks and spacing
const renderFormattedTranscription = () => {
  if (!transcriptionText) {
    return <Text style={styles.placeholderText}>Transcription will appear here...</Text>;
  }
  
  return (
    <Text style={styles.transcriptionText}>
      {transcriptionText}
    </Text>
  );
};
```

### 4.2 Text Export Implementation

```javascript
// Export-related state
const [showExportModal, setShowExportModal] = useState(false);
const [exportFilename, setExportFilename] = useState('');
const [includeTimestamps, setIncludeTimestamps] = useState(false);
const [isExporting, setIsExporting] = useState(false);

// Initialize export modal with default filename
const handleExportTranscription = () => {
  setExportFilename(getDefaultFilename());
  setShowExportModal(true);
};

// Generate default filename with date and time
const getDefaultFilename = () => {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `Transcription_${date}_${time}.txt`;
};

// Handle export confirmation
const handleExportConfirm = async () => {
  try {
    setIsExporting(true);
    
    // Ensure valid filename
    let filename = exportFilename.trim();
    if (!filename) {
      filename = getDefaultFilename();
    }
    if (!filename.endsWith('.txt')) {
      filename += '.txt';
    }
    
    // Format the transcription text
    let content = transcriptionText;
    
    // Add timestamps if selected and available
    if (includeTimestamps && transcriptionSegments.length > 0) {
      content = formatWithTimestamps(transcriptionSegments);
    }
    
    // Write to temporary file
    const tempFilePath = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(tempFilePath, content);
    
    // Share the file
    await shareTranscriptionFile(tempFilePath, filename);
    
    setIsExporting(false);
    setShowExportModal(false);
    
  } catch (error) {
    console.error('Error exporting transcription:', error);
    setIsExporting(false);
    Alert.alert('Export Error', 'Failed to export transcription: ' + error.message);
  }
};

// Format transcription with timestamps
const formatWithTimestamps = (segments) => {
  return segments.map(segment => {
    const startTime = formatTimestamp(segment.t0);
    const endTime = formatTimestamp(segment.t1);
    return `[${startTime} - ${endTime}] ${segment.text}`;
  }).join('\n\n');
};

// Format timestamp in readable format
const formatTimestamp = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// Share the exported file
const shareTranscriptionFile = async (filePath, filename) => {
  try {
    const options = {
      url: Platform.OS === 'ios' ? `file://${filePath}` : filePath,
      type: 'text/plain',
      subject: 'Whisper Transcription',
      message: 'Here is your transcription file',
      saveToFiles: true
    };
    
    // Use sharing API
    await Sharing.shareAsync(filePath, {
      mimeType: 'text/plain',
      dialogTitle: 'Share Transcription',
      UTI: 'public.plain-text'
    });
    
  } catch (error) {
    console.error('Error sharing transcription:', error);
    throw error;
  }
};

// Save file to documents directory
const saveToDocuments = async (tempFilePath, filename) => {
  try {
    const documentsPath = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.copyAsync({
      from: tempFilePath,
      to: documentsPath
    });
    return documentsPath;
  } catch (error) {
    console.error('Error saving to documents:', error);
    throw error;
  }
};
```

---

## 5. Performance Considerations

### Real-Time Transcription Performance

1. **Latency vs. Accuracy:** 
   - Streaming transcription has inherent latency-accuracy tradeoffs
   - Smaller audio segments reduce latency but may decrease accuracy
   - The turbo model is recommended for all real-time profiles

2. **Memory Management:**
   - Real-time transcription uses continuous memory allocation
   - Ensure stable memory usage by using appropriate segment sizes
   - Monitor for memory growth during long sessions

3. **Battery Impact:**
   - Real-time transcription is CPU and battery intensive
   - Add battery level monitoring for long sessions
   - Consider UI indicators for battery impact

4. **Audio Session Management:**
   - Properly configure and release audio sessions
   - Handle audio interruptions (phone calls, etc.)
   - Release resources when switching away from the app

### Text Export Performance

1. **File Size Considerations:**
   - Text files are generally small and fast to process
   - Even hours of transcription result in manageable file sizes

2. **UI Responsiveness:**
   - Perform file operations asynchronously
   - Show progress indicators for longer exports
   - Don't block UI thread during export

---

## 6. Testing Strategy

### Real-Time Transcription Testing

1. **Functional Testing:**
   - Test starting and stopping of real-time transcription
   - Test all performance profiles
   - Verify transcription accuracy with controlled audio samples

2. **Environmental Testing:**
   - Test in quiet environments
   - Test with background noise
   - Test with multiple speakers
   - Test with different accents

3. **Stress Testing:**
   - Test continuous operation for extended periods (30+ minutes)
   - Test with rapid start/stop sequences
   - Test with app backgrounding and foregrounding

4. **Error Case Testing:**
   - Test with microphone permissions denied
   - Test with audio session interruptions
   - Test with deliberate network or service disruptions

### Text Export Testing

1. **Functional Testing:**
   - Test basic export functionality
   - Test with and without timestamps
   - Test with varying file names and content lengths

2. **Integration Testing:**
   - Test sharing via various apps (Mail, Messages, etc.)
   - Test saving to Files app
   - Test opening in other applications

3. **Edge Cases:**
   - Test with very long transcriptions
   - Test with special characters in filenames
   - Test with empty transcriptions

---

## 7. Risk Assessment

### Real-Time Transcription Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|------------|------------|
| High latency | Medium | Medium | Optimize audio segment size, use turbo model |
| Memory growth | High | Medium | Monitor memory usage, release resources, limit session length |
| Battery drain | Medium | High | Add battery warnings, optimize processing |
| Audio interruptions | Medium | Medium | Handle interruption events gracefully |
| Poor accuracy | High | Medium | Provide user feedback, suggest controlled environment |

### Text Export Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|------------|------------|
| File access issues | High | Low | Use proper permissions, check write access before export |
| Share sheet failures | Medium | Low | Add error handling, provide alternative export methods |
| Invalid filenames | Low | Medium | Sanitize filenames, add validation |
| Export timeouts | Medium | Low | Add timeout handling, progress indicators |

---

This design document outlines the approach for implementing real-time transcription and text export capabilities in the WhisperRN iOS application. The implementation will build on the existing performance optimizations while adding these new features to enhance the app's functionality.
