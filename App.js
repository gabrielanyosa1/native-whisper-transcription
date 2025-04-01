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
import { 
  isWavFile, 
  pickAudioFileForTranscription, 
  startRecording,
  processRecordingForTranscription 
} from './audioUtils';

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
  
  // Refs to maintain persistence between renders
  const whisperContextRef = useRef(null);
  const recordingRef = useRef(null);
  const audioUriRef = useRef(null);
  
  // Load model once when component mounts
  useEffect(() => {
    loadWhisperModel();
    
    // Cleanup when component unmounts
    return () => {
      // Release whisper model resources when app closes
      if (whisperContextRef.current) {
        try {
          whisperContextRef.current.release();
        } catch (error) {
          console.error('Error releasing Whisper resources:', error);
        }
      }
    };
  }, []);

  const loadWhisperModel = async () => {
    // Skip if model is already loaded
    if (whisperContextRef.current) {
      return;
    }
    
    try {
      setIsLoading(true);
      setStatus('Preparing Whisper model...');
      
      // Get the path to the model file
      let modelPath;
      
      if (Platform.OS === 'ios') {
        // For iOS, we need to get the path to the bundled resource
        modelPath = FileSystem.documentDirectory + 'ggml-large-v3-q5_0.bin';
        const fileInfo = await FileSystem.getInfoAsync(modelPath);
        
        if (!fileInfo.exists) {
          setStatus('Copying model file (first launch only)...');
          // First time: Copy the file from the bundle to a location we can access
          const bundlePath = FileSystem.bundleDirectory + 'ggml-large-v3-q5_0.bin';
          await FileSystem.copyAsync({
            from: bundlePath,
            to: modelPath
          });
        }
      }
      
      setStatus('Initializing Whisper model (this may take a moment)...');
      setProgress(0.3);
      
      // Initialize whisper with the model path and store in ref
      whisperContextRef.current = await initWhisper({
        filePath: modelPath,
        useGpu: true,
        useFlashAttn: true
      });

      // Log if GPU is being used for debugging
      console.log('Whisper model loaded with GPU:', whisperContextRef.current.gpu);
      if (!whisperContextRef.current.gpu) {
        console.log('Reason GPU not enabled:', whisperContextRef.current.reasonNoGPU);
      }
      
      setIsModelLoaded(true);
      setStatus('Model loaded and ready for transcription');
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
      setStatus('Starting transcription with language detection...');
      setProgress(0.5);
      
      // For debugging, log the file type and options
      if (typeof audioPath === 'string') {
        console.log(`Transcribing file: ${audioPath}`);
        console.log(`Is WAV file: ${isWavFile(audioPath)}`);
      } else {
        console.log('Transcribing bundled asset');
      }
      console.log('Transcription options:', options);
      
      // Add optimized options for iPhone 15 Pro
      const enhancedOptions = {
        ...options,
        maxThreads: 6,       // Use more threads for faster processing
        beamSize: 3,         // Speed optimization (default is 5)
        bestOf: 3,            // Faster inference (default is 5)
        temperature: 0.0
      };
      
      // Start transcription using the already loaded model
      const { promise } = whisperContextRef.current.transcribe(audioPath, enhancedOptions);
      
      // Add progress updates
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 0.05, 0.95));
      }, 500);
      
      const { result: transcriptionResult } = await promise;
      
      clearInterval(progressInterval);
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