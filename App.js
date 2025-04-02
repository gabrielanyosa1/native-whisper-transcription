import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text, // Import Text!
  View,
  Platform,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { initWhisper } from 'whisper.rn';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Asset } from 'expo-asset';
import {
  pickAudioFileForTranscription,
  startRecording,
  processRecordingForTranscription,
  getAudioDuration,
  // --- Import uriToPath helper ---
  uriToPath,
} from './audioUtils'; // Assuming audioUtils uses the bridge

// Import performance optimization modules
import { PERFORMANCE_PROFILES, DEFAULT_PERFORMANCE_MODE, getTranscriptionOptions } from './PerformanceProfiles';
import { AudioChunker } from './AudioChunker'; // AudioChunker now imports its own utils
import { ModelManager } from './ModelManager';
import PerformanceModeSelector from './PerformanceModeSelector';
import ModelDownloadInfo from './ModelDownloadInfo';

// --- Native Module Setup ---
const AVFoundationAudioModule = Platform.OS === 'ios' ? NativeModules.AVFoundationAudio : null;

if (Platform.OS === 'ios') {
  if (AVFoundationAudioModule) {
    console.log('[App.js] AVFoundationAudio native module found in NativeModules.');
  } else {
    console.warn('[App.js] AVFoundationAudio native module NOT found in NativeModules! Native features will fail.');
  }
}

const eventEmitter = AVFoundationAudioModule ? new NativeEventEmitter(AVFoundationAudioModule) : null;
// --- End Native Module Setup ---


// Ensure models are bundled with the app
const ensureModelsIncluded = () => {
  try {
    if (Platform.OS === 'ios') {
      console.log('Referencing models for bundling...');
      try {
        const largeModel = require('./assets/models/ggml-large-v3-q5_0.bin');
        const turboModel = require('./assets/models/ggml-large-v3-turbo-q5_0.bin');
        console.log('Models referenced for bundling (require paths exist)');
      } catch (err) {
        console.warn('Could not reference model files directly via require:', err.message);
        console.log('This is expected if models are downloaded or only in the native bundle.');
      }
    }
  } catch (e) {
    console.warn('Model reference check error:', e);
  }
};
ensureModelsIncluded();


export default function App() {
  // --- State Definitions ---
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [isLoading, setIsLoading] = useState(true);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionHistory, setTranscriptionHistory] = useState([]);
  const [progress, setProgress] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(DEFAULT_PERFORMANCE_MODE);

  // --- Refs ---
  const whisperContextRef = useRef(null);
  const recordingRef = useRef(null);
  const audioChunkerRef = useRef(null);
  const modelManagerRef = useRef(null);

  // --- Effects ---
  useEffect(() => {
     modelManagerRef.current = new ModelManager({ // Initialize Model Manager
       initWhisper,
       onProgress: setProgress,
       onStatusUpdate: setStatus
     });

     loadWhisperModel(); // Load initial model

     // Setup the Native Log Event Listener
     let logListener = null;
     if (eventEmitter) {
       console.log("[App.js] Setting up NativeLogEvent listener...");
       logListener = eventEmitter.addListener(
         'NativeLogEvent',
         (event) => {
           const level = event.level || 'INFO';
           const message = event.message || '';
           const functionName = event.function ? event.function.split('/').pop() : 'unknownFn';
           const line = event.line || '?';
           const osStatus = event.osStatus !== undefined ? ` (OSStatus: ${event.osStatus})` : '';
           const logString = `[Native ${level}] [${functionName}:${line}] ${message}${osStatus}`;

           switch (level.toUpperCase()) { // Compare uppercase
             case 'FATAL':
             case 'ERROR': console.error(logString); break;
             case 'WARN': console.warn(logString); break;
             case 'INFO': console.log(logString); break;
             case 'DEBUG':
             case 'VERBOSE': console.log(logString); break;
             default: console.log(logString);
           }
         }
       );
       console.log("[App.js] NativeLogEvent listener added.");
     } else {
         console.warn("[App.js] NativeEventEmitter not available. Native logs via events will not be shown.");
     }

     // Cleanup function
     return () => {
       console.log("[App.js] Cleanup: Releasing model...");
       releaseModel(); // Call the async release function

       if (logListener) {
         console.log("[App.js] Cleanup: Removing NativeLogEvent listener...");
         logListener.remove();
         console.log("[App.js] Cleanup: NativeLogEvent listener removed.");
       }
     };
  }, []); // Run only once on mount

  // --- Async Functions / Handlers ---

  const loadWhisperModel = async () => {
    try {
      setStatus('Loading transcription model...');
      setIsLoading(true);
      setProgress(0);
      if (!modelManagerRef.current) throw new Error("Model manager not initialized");
      whisperContextRef.current = await modelManagerRef.current.loadModel(performanceMode);
      setIsModelLoaded(true);
      setStatus('Model loaded successfully!');
      console.log('Whisper model loaded successfully for mode:', performanceMode);
      setTimeout(() => {
        if (!isRecording) setStatus('Ready to transcribe');
        setProgress(0);
        setIsLoading(false);
      }, 1500);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Model loading error:', error);
      setStatus('Error loading model: ' + error.message);
      setIsModelLoaded(false);
      setIsLoading(false);
      Alert.alert('Model Loading Error', `Failed to load model: ${error.message}.`);
    }
  };

  const releaseModel = async () => {
    try {
      if (modelManagerRef.current) await modelManagerRef.current.releaseModel();
      whisperContextRef.current = null;
      setIsModelLoaded(false);
      console.log("Whisper model released.");
    } catch (error) {
      console.warn('Error releasing model:', error);
    }
  };

  const handlePerformanceModeChange = async (newMode) => {
    if (isLoading || isRecording) return Alert.alert('Cannot Change Mode', 'Please wait...');
    if (newMode === performanceMode) return;
    console.log(`Performance mode changed to: ${newMode}`);
    setPerformanceMode(newMode);
    if (modelManagerRef.current && modelManagerRef.current.doesRequireModelChange(newMode)) {
      try {
        setStatus(`Switching model for ${newMode} mode...`);
        setIsLoading(true); setIsModelLoaded(false); setProgress(0);
        await releaseModel();
        whisperContextRef.current = await modelManagerRef.current.loadModel(newMode);
        setIsModelLoaded(true); setStatus(`Model for ${newMode} mode loaded!`);
        console.log(`Model switched and loaded successfully for mode: ${newMode}`);
        setTimeout(() => {
          if (!isRecording) setStatus('Ready to transcribe');
          setProgress(0); setIsLoading(false);
        }, 1500);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error('Error switching model:', error);
        setStatus('Error switching model: ' + error.message);
        setIsModelLoaded(false); setIsLoading(false);
        Alert.alert('Model Switching Error', `Failed to switch model: ${error.message}.`);
      }
    } else {
      console.log("Model change not required.");
      setStatus('Performance settings updated.');
       setTimeout(() => { if (!isRecording) setStatus('Ready to transcribe'); }, 1000);
    }
  };

  // Transcribe Audio (handles both chunking and direct)
  // Accepts audioUri (file:// URI or asset identifier)
  const transcribeAudio = async (audioUri, sourceName = 'Audio File', audioDurationMs = null) => {
    if (!whisperContextRef.current || !isModelLoaded) {
      setStatus('Model not loaded. Loading...');
      await loadWhisperModel();
      if (!whisperContextRef.current || !isModelLoaded) {
        setStatus('Model could not be loaded. Cannot transcribe.');
        Alert.alert('Model Error', 'Transcription model is not loaded. Please restart the app.');
        setIsLoading(false);
        return null;
      }
    }

    setIsLoading(true);
    setStatus('Starting transcription...');
    setProgress(0.01);
    setResult('');

    try {
      const isBundledAsset = typeof audioUri !== 'string' || !audioUri.startsWith('file://');
      const logPath = isBundledAsset ? sourceName : audioUri;
      console.log(`[App.js] Transcribing: ${logPath}`);

      const transcriptionOptions = getTranscriptionOptions(performanceMode);
      console.log('[App.js] Using transcription options:', transcriptionOptions);

      // Determine duration if needed for chunking decision
      let effectiveDuration = audioDurationMs;
      if ((!effectiveDuration || effectiveDuration <= 0) && !isBundledAsset && Platform.OS === 'ios') {
          console.log("[App.js] Duration not provided or invalid, attempting to get it via audioUtils...");
          try {
              effectiveDuration = await getAudioDuration(audioUri); // Expects URI
              console.log(`[App.js] Got duration via audioUtils: ${effectiveDuration}ms`);
              if (!effectiveDuration || effectiveDuration <= 0) effectiveDuration = 60000; // Fallback if util returns invalid
          } catch (e) {
              console.warn("[App.js] Failed to get duration before transcription:", e);
              effectiveDuration = 60000; // Use default if fetch fails
          }
      } else if (!effectiveDuration || effectiveDuration <= 0) {
          effectiveDuration = 60000; // Default if not iOS file or not provided/invalid
      }

      // Chunking decision
      const profile = PERFORMANCE_PROFILES[performanceMode] || PERFORMANCE_PROFILES.balanced;
      const chunkThreshold = profile.chunkSizeMs + profile.overlapMs; // Use threshold slightly > chunk size
      const shouldUseChunking = Platform.OS === 'ios' && !isBundledAsset && effectiveDuration > chunkThreshold;

      let transcriptionResultText = '';

      if (shouldUseChunking) {
        console.log(`[App.js] Attempting transcription with chunking (Duration: ${effectiveDuration}ms > Threshold: ${chunkThreshold}ms)...`);
        try {
          if (audioChunkerRef.current) audioChunkerRef.current.cancel();
          // Instantiate AudioChunker - it imports its own audio utils now
          audioChunkerRef.current = new AudioChunker({
            performanceMode,
            onProgress: (val) => setProgress(val * 0.95),
            onStatusUpdate: (msg) => setStatus(`Chunker: ${msg}`),
            whisperContext: whisperContextRef.current,
          });

          // Pass URI to chunker
          const resultObj = await audioChunkerRef.current.transcribeWithChunking(audioUri, transcriptionOptions, effectiveDuration);
          transcriptionResultText = resultObj.result;
          setProgress(0.98);
        } catch (chunkError) {
          console.error('[App.js] Chunking failed, attempting direct transcription:', chunkError);
          setStatus('Chunking failed, trying direct transcription...');
          setProgress(0);

          if (whisperContextRef.current?.transcribe) {
            // --- Use uriToPath helper for fallback ---
            const audioPath = uriToPath(audioUri); // Convert URI to Path
            console.log(`[App.js] Fallback direct transcription for PATH: ${audioPath}`);
            const { promise } = whisperContextRef.current.transcribe(audioPath, transcriptionOptions); // Pass PATH
            const progressInterval = setInterval(() => setProgress((p) => Math.min(p + 0.1, 0.95)), 500);
            const { result: directResultText } = await promise;
            clearInterval(progressInterval);
            transcriptionResultText = directResultText || '';
            setProgress(0.98);
          } else {
            throw new Error('Whisper context became invalid during fallback');
          }
        } finally {
            // Chunker now handles its own cleanup internally
            audioChunkerRef.current = null;
        }

      } else {
        console.log("[App.js] Using direct transcription (no chunking)...");
        if (whisperContextRef.current?.transcribe) {
          // --- Use uriToPath helper for direct transcription ---
          // whisper.rn transcribe expects a path for local files, or asset path/id
          const transcribeInput = isBundledAsset ? audioUri : uriToPath(audioUri); // Convert URI to Path if needed
          console.log(`[App.js] Direct transcription input: ${transcribeInput}`);
          const { promise } = whisperContextRef.current.transcribe(transcribeInput, transcriptionOptions); // Pass Path or Asset ID
          const progressInterval = setInterval(() => setProgress((p) => Math.min(p + 0.05, 0.95)), 500);
          const { result: directResultText } = await promise;
          clearInterval(progressInterval);
          transcriptionResultText = directResultText || '';
          setProgress(0.98);
        } else {
          throw new Error('Whisper context is not available for direct transcription');
        }
      }

      // --- Process Final Result ---
      setProgress(1);
      const finalResult = transcriptionResultText.trim(); // Trim whitespace
      console.log(`[App.js] Raw Transcription result: "${finalResult}"`);
      setResult(finalResult);

      const timestamp = new Date().toLocaleTimeString();
      const historySourceName = isBundledAsset ? 'Sample Audio' : sourceName;
      setTranscriptionHistory(prevHistory => [
        { id: Date.now().toString(), text: finalResult, time: timestamp, source: historySourceName },
        ...prevHistory
      ]);

      setStatus('Transcription complete!');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setTimeout(() => {
        if (!isRecording) setStatus('Ready to transcribe');
        setProgress(0);
        setIsLoading(false);
      }, 1500);

      return finalResult; // Return the processed result

    } catch (error) {
      console.error('[App.js] Transcription error:', error);
      setStatus(`Error: ${error.message}`);
      setIsLoading(false);
      setProgress(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Transcription Failed', `An error occurred: ${error.message}`);
      return null;
    }
  };

  // --- Button Handlers ---

  const pickAudioFile = async () => {
      if (isLoading || isRecording) return;
    try {
      setStatus('Selecting audio file...');
      setIsLoading(true); // Set loading early
      const pickedFileInfo = await pickAudioFileForTranscription(); // Uses audioUtils

      if (!pickedFileInfo || pickedFileInfo.canceled) {
        setStatus(pickedFileInfo?.message || 'File selection canceled or failed.');
        setIsLoading(false); return;
      }

      setStatus(`${pickedFileInfo.converted ? 'Converted' : 'Selected'}: ${pickedFileInfo.name}`);
      // Proceed to transcription - pass URI, transcribeAudio handles path/duration
      await transcribeAudio(pickedFileInfo.uri, pickedFileInfo.name);
      // transcribeAudio now handles setting isLoading to false

    } catch (error) {
      console.error('[App.js] File picking/processing error:', error);
      setStatus(`Error selecting file: ${error.message}`);
       Alert.alert('File Error', `Could not process the selected file: ${error.message}`);
       setIsLoading(false);
    }
  };

  const startAudioRecording = async () => {
      if (isLoading || isRecording) return;
    try {
      setStatus('Starting recording...');
      setIsLoading(true);
      const recording = await startRecording(); // Uses audioUtils
      recordingRef.current = recording;
      setIsRecording(true);
      setStatus('Recording... Tap to stop');
      setIsLoading(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('[App.js] Start recording error:', error);
      setStatus(`Recording error: ${error.message}`);
      Alert.alert('Recording Error', `Could not start recording: ${error.message}`);
      setIsRecording(false); setIsLoading(false); recordingRef.current = null;
    }
  };

  const stopAudioRecording = async () => {
    if (!isRecording || !recordingRef.current) return;
    setIsLoading(true); setIsRecording(false);
    setStatus('Stopping and processing recording...');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const currentRecording = recordingRef.current;
    recordingRef.current = null;
    try {
        // Uses audioUtils - handles stop, uri, duration, format check
        const { uri: processedUri, duration: durationMillis } = await processRecordingForTranscription(currentRecording);
        if (!processedUri) throw new Error("Could not get valid URI from recording processing.");
        // Call transcribeAudio with URI and duration
        await transcribeAudio(processedUri, 'Recorded Audio', durationMillis);
        // transcribeAudio handles setting isLoading false
    } catch (error) {
      console.error('[App.js] Error stopping/processing recording:', error);
      setStatus(`Error processing recording: ${error.message}`);
      Alert.alert('Processing Error', `Could not process the recording: ${error.message}`);
      setIsLoading(false); // Ensure loading state stops on error
    }
  };

  const transcribeSample = async () => {
      if (isLoading || isRecording) return;
     try {
       setIsLoading(true); setStatus('Preparing sample audio...'); setProgress(0.01);
       const sampleAsset = Asset.fromModule(require('./assets/sample.wav'));
       if (!sampleAsset.downloaded) {
           setStatus('Downloading sample asset...');
           await sampleAsset.downloadAsync();
       }
       const sampleUri = sampleAsset.localUri;
       if (!sampleUri) throw new Error("Could not get local URI for sample asset.");
       console.log(`[App.js] Using sample asset URI: ${sampleUri}`);
       setStatus('Transcribing sample...');
       await transcribeAudio(sampleUri, 'Sample Audio'); // Pass URI directly
     } catch (error) {
       console.error('[App.js] Sample transcription error:', error);
       setStatus(`Error transcribing sample: ${error.message}`);
       Alert.alert('Sample Error', `Could not transcribe sample: ${error.message}`);
       setIsLoading(false); setProgress(0);
     }
   };

  const clearHistory = () => {
      if (isLoading || isRecording) return;
    setTranscriptionHistory([]); setResult('');
    setStatus('History cleared. Ready to transcribe.');
     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const cancelTranscription = () => {
    console.log("[App.js] Cancel requested...");
    if (audioChunkerRef.current) {
      audioChunkerRef.current.cancel(); // Delegate cancellation to chunker
      // UI updates (isLoading, status) should happen based on chunker throwing error or completing
    } else {
      console.log("[App.js] No active chunker process to cancel.");
      // Optionally add cancellation logic for whisper.rn's direct transcribe if possible
      // For now, we just rely on the operation finishing or erroring out.
      // You might forcefully reset state here if needed:
      // setIsLoading(false); setStatus('Cancellation attempted.'); setProgress(0);
    }
  };

   const handleDeleteModels = async () => {
       if (isLoading || isRecording) return;
     try {
       setIsLoading(true); setStatus('Deleting downloaded models...'); setProgress(0);
       if (!modelManagerRef.current) throw new Error("Model manager not available");
       await releaseModel(); // Release currently loaded model first
       const result = await modelManagerRef.current.deleteAllModels(); // Uses ModelManager
       if (result) {
         setStatus('Models deleted successfully.'); setIsModelLoaded(false);
         setTimeout(() => { setIsLoading(false); setProgress(0); setStatus('Models deleted.'); }, 1500);
         Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
       } else {
         setStatus('Failed to delete models (or no models found).'); setIsLoading(false);
       }
     } catch (error) {
       console.error('[App.js] Error deleting models:', error);
       setStatus(`Error deleting models: ${error.message}`); setIsLoading(false);
       Alert.alert('Deletion Error', `Could not delete models: ${error.message}`);
     }
   };

  // --- UI Rendering Functions ---
  const renderProgressBar = () => { /* ... (keep as is) ... */ };
  const renderHistory = () => { /* ... (keep as is) ... */ };

  // --- Main Return JSX ---
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Whisper Expo</Text>
        {isModelLoaded && <Text style={styles.modelStatus}>Model Loaded</Text>}
      </View>
      {renderProgressBar()}
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
        disabled={isLoading || isRecording}
      />
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>{status}</Text>
        {isLoading && <ActivityIndicator style={styles.loader} color="#007aff" />}
      </View>
      <View style={styles.resultContainer}>
        {result ? (
          <ScrollView style={styles.resultScroll}>
            <Text style={styles.resultText} selectable={true}>{result}</Text>
          </ScrollView>
        ) : ( <Text style={styles.placeholderText}>{isLoading ? 'Processing...' : 'Transcription Output'}</Text> )}
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={[styles.button, styles.fileButton, (isLoading || isRecording) && styles.disabledButton]} onPress={pickAudioFile} disabled={isLoading || isRecording}>
          <Text style={styles.buttonText}>Select File</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[ styles.button, styles.recordButton, isRecording ? styles.recordingButton : null, isLoading && !isRecording && styles.disabledButton ]} onPress={isRecording ? stopAudioRecording : startAudioRecording} disabled={isLoading && !isRecording}>
          <Text style={styles.buttonText}>{isRecording ? "Stop Record" : "Record"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.sampleButton, (isLoading || isRecording) && styles.disabledButton]} onPress={transcribeSample} disabled={isLoading || isRecording}>
          <Text style={styles.buttonText}>Sample</Text>
        </TouchableOpacity>
      </View>
      {isLoading && !isRecording && (
        <TouchableOpacity style={styles.cancelButton} onPress={cancelTranscription}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>History</Text>
        {transcriptionHistory.length > 0 && !isLoading && !isRecording && (
          <TouchableOpacity onPress={clearHistory} disabled={isLoading || isRecording}>
            <Text style={styles.clearButton}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.historyContainer}>
        {renderHistory()}
      </View>
    </SafeAreaView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa' },
  header: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 15 : 10, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#e1e4e8', backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '600', color: '#1a1a1a' },
  modelStatus: { fontSize: 11, color: '#2e7d32', backgroundColor: '#e8f5e9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, fontWeight: '500' },
  progressBarContainer: { height: 3, backgroundColor: '#e1e4e8', width: '100%' },
  progressBar: { height: '100%', backgroundColor: '#007aff' },
  statusContainer: { paddingVertical: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  statusText: { fontSize: 14, color: '#586069', textAlign: 'center', flexShrink: 1 },
  loader: { marginLeft: 8 },
  resultContainer: { marginHorizontal: 15, marginTop: 5, marginBottom: 10, padding: 15, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5da', flex: 1, minHeight: 100 },
  resultScroll: { flex: 1 },
  resultText: { fontSize: 15, color: '#24292e', lineHeight: 22 },
  placeholderText: { fontSize: 15, color: '#959da5', textAlign: 'center', paddingTop: 20 },
  buttonContainer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingBottom: Platform.OS === 'ios' ? 0 : 10, paddingTop: 5 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginHorizontal: 5, minHeight: 44 },
  fileButton: { backgroundColor: '#0366d6' },
  recordButton: { backgroundColor: '#d73a49' },
  recordingButton: { backgroundColor: '#f66a0a' }, // Indicate active recording
  sampleButton: { backgroundColor: '#6f42c1' },
  disabledButton: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 14, textAlign: 'center' },
  cancelButton: { marginHorizontal: 15, marginBottom: 10, paddingVertical: 10, backgroundColor: '#6a737d', borderRadius: 6, alignItems: 'center' },
  cancelButtonText: { color: 'white', fontWeight: '600', fontSize: 14 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5, borderTopWidth: 1, borderTopColor: '#e1e4e8', backgroundColor: '#f7f8fa' },
  historyTitle: { fontSize: 16, fontWeight: '600', color: '#24292e' },
  clearButton: { color: '#0366d6', fontSize: 14, fontWeight: '500' },
  historyContainer: { flex: 1, paddingBottom: 10 },
  historyScrollView: { paddingHorizontal: 15 },
  emptyHistoryContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  emptyHistoryText: { color: '#6a737d', fontSize: 14 },
  historyItem: { padding: 12, backgroundColor: 'white', borderRadius: 6, marginVertical: 4, borderWidth: 1, borderColor: '#e1e4e8' },
  historySource: { fontSize: 11, color: '#586069', marginBottom: 4, fontWeight: '500' },
  historyText: { fontSize: 14, color: '#24292e', lineHeight: 20 },
});