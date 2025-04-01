import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  Platform, 
  SafeAreaView, 
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { initWhisper } from 'whisper.rn';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Asset } from 'expo-asset';
import { 
  isWavFile, 
  pickAudioFileForTranscription, 
  startRecording,
  processRecordingForTranscription 
} from './audioUtils';

// Import our new performance optimization modules
import { PERFORMANCE_PROFILES, DEFAULT_PERFORMANCE_MODE, getTranscriptionOptions } from './PerformanceProfiles';
import { AudioChunker } from './AudioChunker';
import { ModelManager } from './ModelManager';
import PerformanceModeSelector from './PerformanceModeSelector';
import ModelDownloadInfo from './ModelDownloadInfo';

// Ensure models are bundled with the app
const ensureModelsIncluded = () => {
  try {
    if (Platform.OS === 'ios') {
      // This just ensures the bundler sees these files
      // Note: Adjust paths if your models are located elsewhere
      try {
        console.log('Referencing models for bundling...');
        // These paths will need to be adjusted to where your models are actually stored
        const largeModel = require('./assets/models/ggml-large-v3-q5_0.bin');
        const turboModel = require('./assets/models/ggml-large-v3-turbo-q5_0.bin');
        console.log('Models referenced for bundling');
      } catch (err) {
        console.warn('Could not reference model files directly:', err.message);
        console.log('This is expected if models are in the iOS bundle but not in the assets folder');
      }
    }
  } catch (e) {
    console.warn('Model reference error:', e);
  }
};
ensureModelsIncluded();

export default function App() {
  // State management
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('Ready to transcribe');
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionHistory, setTranscriptionHistory] = useState([]);
  const [progress, setProgress] = useState(0);
  const [formatWarning, setFormatWarning] = useState('');
  
  // New state for performance mode
  const [performanceMode, setPerformanceMode] = useState(DEFAULT_PERFORMANCE_MODE);
  
  // Refs to maintain persistence between renders
  const whisperContextRef = useRef(null);
  const recordingRef = useRef(null);
  const audioUriRef = useRef(null);
  const audioChunkerRef = useRef(null);
  
  // Create model manager
  const modelManagerRef = useRef(null);
  
  // Initialize model manager
  useEffect(() => {
    modelManagerRef.current = new ModelManager({
      initWhisper,
      onProgress: setProgress,
      onStatusUpdate: setStatus
    });
    
    // Load model once when component mounts
    loadWhisperModel();
    
    // Cleanup when component unmounts
    return () => {
      releaseModel();
    };
  }, []);

  const loadWhisperModel = async () => {
    try {
      setIsLoading(true);
      
      // Use model manager to load the selected model
      whisperContextRef.current = await modelManagerRef.current.loadModel(performanceMode);
      setIsModelLoaded(true);
      
      // After a delay, reset UI to idle state
      setTimeout(() => {
        setIsLoading(false);
        setProgress(0);
      }, 1000);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Model loading error:', error);
      setStatus('Error loading model: ' + error.message);
      setIsLoading(false);
      Alert.alert(
        'Model Loading Error',
        'There was an error loading the transcription model. Please restart the app and try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const releaseModel = async () => {
    try {
      if (modelManagerRef.current) {
        await modelManagerRef.current.releaseModel();
      }
      whisperContextRef.current = null;
      setIsModelLoaded(false);
    } catch (error) {
      console.warn('Error releasing model:', error);
    }
  };

  // Handle performance mode change
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

  const transcribeAudio = async (audioPath, options = { language: 'auto' }) => {
    if (!whisperContextRef.current) {
      await loadWhisperModel();
      // If still not loaded, exit
      if (!whisperContextRef.current) {
        setStatus('Model could not be loaded. Please restart the app.');
        return;
      }
    }
  
    try {
      setIsLoading(true);
      setStatus('Starting transcription...');
      setProgress(0.1);
      
      // For debugging, log the file type and options
      if (typeof audioPath === 'string') {
        console.log(`Transcribing file: ${audioPath}`);
        console.log(`Is WAV file: ${isWavFile(audioPath)}`);
      } else {
        console.log('Transcribing bundled asset');
      }
      
      // Get transcription options based on performance mode
      const transcriptionOptions = getTranscriptionOptions(performanceMode);
      console.log('Transcription options:', transcriptionOptions);
      
      // Check if we should use chunking based on file size/duration
      const shouldUseChunking = typeof audioPath === 'string'; // Only use chunking for files, not bundled assets
      
      let transcriptionResult;
      
      if (shouldUseChunking) {
        try {
          // Initialize audio chunker
          audioChunkerRef.current = new AudioChunker({
            performanceMode,
            onProgress: setProgress,
            onStatusUpdate: setStatus,
            whisperContext: whisperContextRef.current
          });
          
          // Transcribe with chunking
          const result = await audioChunkerRef.current.transcribeWithChunking(audioPath, transcriptionOptions);
          transcriptionResult = result.result;
        } catch (error) {
          console.warn('Chunking failed, falling back to direct transcription:', error);
          setStatus('Chunking failed, using direct transcription...');
          
          // Fallback to direct transcription - make sure whisperContextRef is valid
          if (whisperContextRef.current && typeof whisperContextRef.current.transcribe === 'function') {
            const { promise } = whisperContextRef.current.transcribe(audioPath, transcriptionOptions);
            const { result } = await promise;
            transcriptionResult = result;
          } else {
            throw new Error('Whisper context is not properly initialized');
          }
        }
      } else {
        // For bundled assets, use direct transcription
        const progressInterval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 0.05, 0.95));
        }, 500);
        
        // Start transcription using the loaded model - verify we have a valid context first
        if (whisperContextRef.current && typeof whisperContextRef.current.transcribe === 'function') {
          const { promise } = whisperContextRef.current.transcribe(audioPath, transcriptionOptions);
          const { result } = await promise;
          transcriptionResult = result;
        } else {
          throw new Error('Whisper context is not properly initialized');
        }
        
        clearInterval(progressInterval);
      }
      
      setProgress(1);
      
      // Log the full result for debugging
      console.log('Transcription result:', transcriptionResult);
      
      // Update state with result
      setResult(transcriptionResult);
      
      // Add to history
      const timestamp = new Date().toLocaleTimeString();
      const fileName = typeof audioPath === 'string' ? 
        audioPath.split('/').pop() : 'Recorded audio';
      
      setTranscriptionHistory(prevHistory => [
        { 
          id: Date.now().toString(), 
          text: transcriptionResult, 
          time: timestamp,
          source: fileName
        },
        ...prevHistory
      ]);
      
      setStatus('Transcription complete');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // After a delay, reset UI to idle state
      setTimeout(() => {
        setIsLoading(false);
        setProgress(0);
      }, 1000);
      
      return transcriptionResult;
    } catch (error) {
      console.error('Transcription error:', error);
      setStatus('Error during transcription: ' + error.message);
      setIsLoading(false);
      setProgress(0);
      return null;
    }
  };

  const pickAudioFile = async () => {
    try {
      setStatus('Selecting audio file...');
      
      // Use the new utility to handle file picking and conversion
      const result = await pickAudioFileForTranscription();
      
      if (!result || result.canceled) {
        setStatus('File selection canceled');
        return;
      }
      
      setStatus(`${result.converted ? 'Converted' : 'Selected'} file: ${result.name}`);
      audioUriRef.current = result.uri;
      
      // Start transcription with the (potentially converted) file
      await transcribeAudio(result.uri);
      
    } catch (error) {
      console.error('File picking error:', error);
      setStatus('Error selecting file: ' + error.message);
    }
  };

  const startAudioRecording = async () => {
    try {
      // Use the utility to start recording with proper format
      const recording = await startRecording();
      
      recordingRef.current = recording;
      setIsRecording(true);
      setStatus('Recording... Tap to stop');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
    } catch (error) {
      console.error('Recording error:', error);
      setStatus('Error starting recording: ' + error.message);
      Alert.alert('Recording Error', error.message);
    }
  };

  const stopAudioRecording = async () => {
    try {
      if (!recordingRef.current) return;
      
      // Stop the recording
      await recordingRef.current.stopAndUnloadAsync();
      setIsRecording(false);
      setStatus('Processing recording...');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Process and potentially convert the recording
      const processedUri = await processRecordingForTranscription(recordingRef.current);
      audioUriRef.current = processedUri;
      
      // Reset audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
      
      // Start transcription
      await transcribeAudio(processedUri);
      
    } catch (error) {
      console.error('Error stopping recording:', error);
      setStatus('Error processing recording: ' + error.message);
      setIsRecording(false);
    }
  };

  const transcribeSample = async () => {
    try {
      // Use the sample audio included in the app
      const sampleAudio = require('./assets/sample.wav');
      await transcribeAudio(sampleAudio);
    } catch (error) {
      console.error('Sample transcription error:', error);
      setStatus('Error transcribing sample: ' + error.message);
    }
  };

  const clearHistory = () => {
    setTranscriptionHistory([]);
    setResult('');
    setStatus('History cleared');
  };

  // Cancel transcription
  const cancelTranscription = () => {
    if (audioChunkerRef.current) {
      audioChunkerRef.current.cancel();
      audioChunkerRef.current = null;
    }
    
    setIsLoading(false);
    setStatus('Transcription cancelled');
    setProgress(0);
  };

  // Handle model deletion
  const handleDeleteModels = async () => {
    try {
      setIsLoading(true);
      setStatus('Deleting downloaded models...');
      
      // Release model and delete files
      const result = await modelManagerRef.current.deleteAllModels();
      
      if (result) {
        setStatus('Models deleted successfully');
        setIsModelLoaded(false);
        
        // Reset progress after a delay
        setTimeout(() => {
          setIsLoading(false);
          setProgress(0);
          setStatus('Ready to transcribe');
        }, 1000);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus('Error deleting models');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error deleting models:', error);
      setStatus('Error deleting models: ' + error.message);
      setIsLoading(false);
    }
  };

  // UI components
  const renderProgressBar = () => {
    if (progress === 0) return null;
    
    return (
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
      </View>
    );
  };

  const renderFormatWarning = () => {
    if (!formatWarning) return null;
    
    return (
      <View style={styles.warningContainer}>
        <Text style={styles.warningText}>{formatWarning}</Text>
      </View>
    );
  };

  const renderHistory = () => {
    if (transcriptionHistory.length === 0) {
      return (
        <View style={styles.emptyHistoryContainer}>
          <Text style={styles.emptyHistoryText}>No transcriptions yet</Text>
        </View>
      );
    }
    
    return (
      <ScrollView style={styles.historyContainer}>
        {transcriptionHistory.map((item) => (
          <View key={item.id} style={styles.historyItem}>
            <Text style={styles.historySource}>{item.source} • {item.time}</Text>
            <Text style={styles.historyText}>{item.text}</Text>
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Whisper Transcription</Text>
        {isModelLoaded && <Text style={styles.modelStatus}>Model loaded</Text>}
      </View>
      
      {renderProgressBar()}
      {renderFormatWarning()}
      
      {/* Add performance mode selector */}
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
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>{status}</Text>
        {isLoading && <ActivityIndicator style={styles.loader} />}
      </View>
      
      <View style={styles.resultContainer}>
        {result ? (
          <ScrollView style={styles.resultScroll}>
            <Text style={styles.resultText}>{result}</Text>
          </ScrollView>
        ) : (
          <Text style={styles.placeholderText}>
            Transcription will appear here
          </Text>
        )}
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.fileButton, isLoading && styles.disabledButton]} 
          onPress={pickAudioFile}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>Select Audio File</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.button, 
            styles.recordButton, 
            isRecording ? styles.recordingButton : null,
            isLoading && !isRecording && styles.disabledButton
          ]} 
          onPress={isRecording ? stopAudioRecording : startAudioRecording}
          disabled={isLoading && !isRecording}
        >
          <Text style={styles.buttonText}>
            {isRecording ? "Stop Recording" : "Record Audio"}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, styles.sampleButton, isLoading && styles.disabledButton]} 
          onPress={transcribeSample}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>Transcribe Sample</Text>
        </TouchableOpacity>
      </View>
      
      {/* Add Cancel button when transcription is in progress */}
      {isLoading && !isRecording && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={cancelTranscription}
        >
          <Text style={styles.cancelButtonText}>Cancel Transcription</Text>
        </TouchableOpacity>
      )}
      
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>Transcription History</Text>
        {transcriptionHistory.length > 0 && (
          <TouchableOpacity onPress={clearHistory}>
            <Text style={styles.clearButton}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {renderHistory()}
    </SafeAreaView>
  );
}

// Use existing styles and add new ones for our added components
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f8fa',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e4e8'
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333'
  },
  modelStatus: {
    fontSize: 12,
    color: '#4CAF50',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: '#e1e4e8',
    width: '100%'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007aff'
  },
  warningContainer: {
    backgroundColor: '#fff3cd',
    padding: 10,
    marginHorizontal: 15,
    marginTop: 10,
    borderRadius: 5
  },
  warningText: {
    color: '#856404',
    fontSize: 14,
    textAlign: 'center'
  },
  statusContainer: {
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center'
  },
  loader: {
    marginLeft: 10
  },
  resultContainer: {
    margin: 15,
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    flex: 1,
    maxHeight: 200
  },
  resultScroll: {
    flex: 1
  },
  resultText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24
  },
  placeholderText: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginTop: 20
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    marginBottom: 15
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 5
  },
  fileButton: {
    backgroundColor: '#007aff'
  },
  recordButton: {
    backgroundColor: '#ff3b30'
  },
  recordingButton: {
    backgroundColor: '#ff9500'
  },
  sampleButton: {
    backgroundColor: '#5856d6'
  },
  disabledButton: {
    opacity: 0.5
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 13
  },
  cancelButton: {
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#8e8e93',
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e1e4e8'
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333'
  },
  clearButton: {
    color: '#007aff',
    fontSize: 14
  },
  historyContainer: {
    flex: 1,
    paddingHorizontal: 15
  },
  emptyHistoryContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30
  },
  emptyHistoryText: {
    color: '#999',
    fontSize: 14
  },
  historyItem: {
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 8,
    marginVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1
  },
  historySource: {
    fontSize: 12,
    color: '#999',
    marginBottom: 5
  },
  historyText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20
  }
});