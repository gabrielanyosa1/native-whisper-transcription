import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { Alert, Platform } from 'react-native';

// Configure audio recording to use WAV format at 16kHz
export const getAudioRecordingOptions = () => {
  return {
    android: {
      extension: '.wav',
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_WAVE,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_PCM_16BIT,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
    },
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
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 256000,
    },
  };
};

// Check if a file is WAV format
export const isWavFile = (filePath) => {
  if (typeof filePath === 'string') {
    return filePath.toLowerCase().endsWith('.wav');
  }
  return true; // For require() assets, assume they're in the correct format
};

// Convert any audio file to WAV format with 16kHz sampling rate
export const convertToWavFormat = async (inputPath) => {
  try {
    // Create output path in app's cache directory
    const outputPath = `${FileSystem.cacheDirectory}converted_${Date.now()}.wav`;
    
    console.log(`Converting file: ${inputPath} to WAV format`);
    
    // FFmpeg command for conversion to 16kHz mono WAV
    const command = `-i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`;
    
    // Execute FFmpeg conversion
    return new Promise((resolve, reject) => {
      FFmpegKit.executeAsync(command, 
        async (session) => {
          const returnCode = await session.getReturnCode();
          
          if (ReturnCode.isSuccess(returnCode)) {
            console.log(`Conversion successful: ${outputPath}`);
            resolve(outputPath);
          } else {
            console.error(`FFmpeg process exited with error: ${returnCode}`);
            const output = await session.getOutput();
            console.error(`Error details: ${output}`);
            reject(new Error('Audio conversion failed'));
          }
        },
        (log) => {
          // Log progress (optional)
          console.log(`FFmpeg log: ${log.getMessage()}`);
        },
        (statistics) => {
          // Progress updates (optional)
          // console.log(`FFmpeg progress: ${statistics.getTime()}`);
        }
      );
    });
  } catch (error) {
    console.error('Error in convertToWavFormat:', error);
    throw error;
  }
};

// Pick an audio file and convert if necessary
export const pickAudioFileForTranscription = async () => {
  try {
    // Select audio file
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true
    });
    
    if (result.canceled) {
      return null;
    }
    
    const fileUri = result.assets[0].uri;
    const fileName = result.assets[0].name;
    
    console.log(`Selected audio file: ${fileName}`);
    
    // Check if conversion is needed
    if (!isWavFile(fileName)) {
      return new Promise((resolve) => {
        Alert.alert(
          'Format Conversion Required',
          'Whisper requires 16kHz WAV files. Would you like to convert this file?',
          [
            { 
              text: 'Cancel', 
              style: 'cancel',
              onPress: () => resolve({ canceled: true })
            },
            { 
              text: 'Convert', 
              onPress: async () => {
                try {
                  const convertedUri = await convertToWavFormat(fileUri);
                  resolve({
                    uri: convertedUri,
                    name: `${fileName.split('.')[0]}.wav`,
                    converted: true
                  });
                } catch (error) {
                  Alert.alert('Conversion Failed', 'Unable to convert the audio file. Try a different file.');
                  resolve({ canceled: true });
                }
              }
            }
          ]
        );
      });
    }
    
    // Return file information if already in WAV format
    return {
      uri: fileUri,
      name: fileName,
      converted: false
    };
  } catch (error) {
    console.error('File picking error:', error);
    throw error;
  }
};

// Start recording with proper format
export const startRecording = async () => {
  try {
    // Request permission
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Microphone permission not granted');
    }
    
    // Set up audio recording
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    
    // Start a new recording with WAV format at 16kHz
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(getAudioRecordingOptions());
    await recording.startAsync();
    
    return recording;
  } catch (error) {
    console.error('Recording error:', error);
    throw error;
  }
};

// Process recording result
export const processRecordingForTranscription = async (recording) => {
  try {
    // Get the recording URI
    const uri = recording.getURI();
    console.log('Recording URI:', uri);
    
    // Validate format (typically should be WAV if using our recording options)
    if (!isWavFile(uri)) {
      console.log('Recording not in WAV format, converting...');
      return await convertToWavFormat(uri);
    }
    
    return uri;
  } catch (error) {
    console.error('Error processing recording:', error);
    throw error;
  }
};