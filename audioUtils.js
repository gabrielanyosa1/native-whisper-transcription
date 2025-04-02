import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { Platform, Alert } from 'react-native';
import { NativeModules } from 'react-native';

// --- Native Module Bridge ---
import AVFoundationAudioBridge from './AVFoundationAudio'; // Handles checks internally

// --- Helper Function: URI to Path ---
// Converts a file:// URI to a standard POSIX path, or returns input if not a file URI.
const uriToPath = (uri) => {
  if (typeof uri === 'string' && uri.startsWith('file://')) {
    const path = uri.replace(/^file:\/\//, '');
    // console.log(`[uriToPath] Converted URI '${uri}' to PATH '${path}'`); // Verbose log if needed
    return path;
  }
  // console.warn(`[uriToPath] Input '${uri}' is not a file URI, returning as is.`);
  return uri; // Return original if not a file URI (e.g., could be path already, or an asset identifier)
};

// --- Helper Function: Path to URI ---
// Converts a POSIX path back to a file:// URI.
const pathToUri = (path) => {
  if (typeof path === 'string' && !path.startsWith('file://') && path.startsWith('/')) {
      return `file://${path}`;
  }
  return path; // Return original if already looks like a URI or not a path
}


// --- Audio Recording Configuration ---
export const getAudioRecordingOptions = () => {
  // Using LINEAR16 for iOS as it seems more reliable with ExtAudioFile conversion later if needed
  // and Whisper generally prefers PCM. Expo-av might default to M4A otherwise.
  return {
    android: { // TODO: Revisit Android options if needed
      extension: '.wav',
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_WAVE,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_PCM_16BIT,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000, // 16000 * 16 * 1
    },
    ios: {
      extension: '.wav', // Target WAV format
      audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MAX,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000, // 16000 * 16 * 1
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
      outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEARPCM // Explicitly Linear PCM -> WAV container
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 128000,
    },
  };
};

// --- File Format Check ---
// Checks filename extension. Native check can be used for more robustness if implemented.
export const isWavFile = (filePathOrUri) => {
  if (typeof filePathOrUri !== 'string') {
    console.warn("[audioUtils] isWavFile called with non-string input, assuming OK:", filePathOrUri);
    return true; // For require() assets or unexpected types, assume correct format
  }
  // Check based on the actual filename, handling both URIs and paths
  const filename = filePathOrUri.split('/').pop();
  return filename.toLowerCase().endsWith('.wav');
};

// --- Audio Conversion (using Native Module) ---
// Accepts URI, passes Path to native
export const convertToWavFormat = async (inputUri) => {
  console.log(`[audioUtils] convertToWavFormat called with URI: ${inputUri}`);
  const inputPath = uriToPath(inputUri);
  // Generate output path in cache directory
  const outputPath = `${uriToPath(FileSystem.cacheDirectory)}converted_${Date.now()}.wav`;
  console.log(`[audioUtils] Attempting conversion: PATH='${inputPath}' -> PATH='${outputPath}'`);

  try {
    // AVFoundationAudioBridge handles the native call and fallbacks/errors
    const resultPath = await AVFoundationAudioBridge.convertToWavFormat(inputPath, outputPath);
    console.log(`[audioUtils] Native conversion successful, returned PATH: ${resultPath}`);
    // Return the result as a file URI, as JS layer mostly uses URIs
    return pathToUri(resultPath);
  } catch (error) {
      console.error(`[audioUtils] convertToWavFormat failed for input path '${inputPath}':`, error);
      throw error; // Re-throw for the caller
  }
};

// --- Audio Duration (using Native Module) ---
// Accepts URI, passes Path to native
export const getAudioDuration = async (audioUri) => {
    console.log(`[audioUtils] getAudioDuration called with URI: ${audioUri}`);
    if (typeof audioUri !== 'string' || !audioUri.startsWith('file://')) {
      console.log('[audioUtils] getAudioDuration: Non-file URI or asset detected, using default duration 60000ms');
      return 60000; // Default for non-string paths or non-file URIs
    }

    const audioPath = uriToPath(audioUri); // Convert URI to Path
   try {
      console.log(`[audioUtils] Requesting native duration for PATH: ${audioPath}`);
      // AVFoundationAudioBridge handles native call, fallbacks, and errors
      const durationMs = await AVFoundationAudioBridge.getAudioDuration(audioPath); // Pass Path
      console.log(`[audioUtils] Native getAudioDuration returned: ${durationMs}ms`);
      // Return duration OR the default if the native module fell back internally or failed
      // The bridge might return the default 60000 itself on failure.
      return durationMs > 0 ? durationMs : 60000;
   } catch (error) {
       // This catch block might be redundant if the bridge handles errors internally and returns default,
       // but good for logging explicit rejections from the bridge/native code.
       console.error(`[audioUtils] Native getAudioDuration threw error for path '${audioPath}':`, error);
       return 60000; // Return default on explicit error
   }
};

// --- Audio Segment Extraction (using Native Module) ---
// Accepts URI, passes Paths to native
export const extractAudioSegment = async (audioUri, startMs, endMs) => {
    console.log(`[audioUtils] extractAudioSegment called with URI: ${audioUri}, Start: ${startMs}, End: ${endMs}`);
    if (typeof audioUri !== 'string' || !audioUri.startsWith('file://')) {
      console.error('[audioUtils] extractAudioSegment: Cannot extract from non-file URI or non-string path.');
      throw new Error('Audio segment extraction only supported for file URIs.');
    }

    const sourcePath = uriToPath(audioUri); // Convert URI to Path
    const outputPath = `${uriToPath(FileSystem.cacheDirectory)}chunk_${Date.now()}_${Math.floor(Math.random() * 1000)}.wav`;
    const durationMs = endMs - startMs;

    if (durationMs <= 0) {
       console.error(`[audioUtils] extractAudioSegment: Invalid duration calculated (${durationMs}ms). Start: ${startMs}, End: ${endMs}`);
       throw new Error('Invalid start/end times for segment extraction.');
    }

    console.log(`[audioUtils] Attempting segment extraction: PATH='${sourcePath}' (${startMs}ms -> ${endMs}ms, Duration: ${durationMs}ms) -> PATH='${outputPath}'`);

   try {
     // Pass Paths to the native module
     const resultPath = await AVFoundationAudioBridge.extractAudioSegment(
       sourcePath,
       outputPath,
       startMs,
       durationMs
     );
     console.log(`[audioUtils] Native segment extraction successful, returned PATH: ${resultPath}`);
     // Return the result as a file URI
     return pathToUri(resultPath);
   } catch (error) {
       console.error(`[audioUtils] extractAudioSegment failed for source path '${sourcePath}':`, error);
       // Re-throw error for the caller (AudioChunker) to handle
       throw error;
   }
};

// --- File Picking and Pre-processing ---
export const pickAudioFileForTranscription = async () => {
  console.log('[audioUtils] Starting file picking...');
  try {
    if (Platform.OS !== 'ios') {
      Alert.alert('Unsupported Platform', 'Audio file processing is currently only available on iOS.');
      return { canceled: true, message: 'Unsupported platform' };
    }
    if (!NativeModules.AVFoundationAudio) {
        Alert.alert('Native Module Missing', 'The required audio processing component is missing. Please ensure the app is built correctly.');
        return { canceled: true, message: 'Native module missing' };
    }

    const pickerResult = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'], // Allow any audio type
      copyToCacheDirectory: true // CRUCIAL: Ask picker to copy to accessible cache
    });

    if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
      console.log('[audioUtils] Document picking cancelled or no asset returned.');
      return { canceled: true, message: 'File selection canceled' };
    }

    const asset = pickerResult.assets[0];
    const pickedUri = asset.uri; // This SHOULD be the cache URI
    const originalName = asset.name;
    const mimeType = asset.mimeType;
    const size = asset.size;

    console.log(`[audioUtils] File picked: Name='${originalName}', URI='${pickedUri}', Type='${mimeType}', Size=${size}`);

    // *** Verify File Existence and Stability in Cache using FileSystem API ***
    let attempts = 0;
    const MAX_ATTEMPTS = 6; // Try for ~3 seconds
    const RETRY_DELAY = 500; // ms
    let fileInfo = null;
    let fileReady = false;

    while (attempts < MAX_ATTEMPTS && !fileReady) {
      try {
        console.log(`[audioUtils] Checking cache file via JS FileSystem (Attempt ${attempts + 1}/${MAX_ATTEMPTS}): ${pickedUri}`);
        fileInfo = await FileSystem.getInfoAsync(pickedUri);
        if (fileInfo.exists && fileInfo.size > 0 && fileInfo.size === size) {
          fileReady = true;
          console.log(`[audioUtils] Cache file confirmed ready via JS FileSystem. Size: ${fileInfo.size}`);
        } else {
          console.warn(`[audioUtils] Cache file check failed via JS FileSystem. Exists: ${fileInfo.exists}, Size: ${fileInfo.size} (Expected: ${size})`);
        }
      } catch (infoError) {
        console.error(`[audioUtils] Error getting file info via JS FileSystem (Attempt ${attempts + 1}):`, infoError);
        break; // Stop retrying if we can't even get info
      }

      if (!fileReady) {
        attempts++;
        if (attempts < MAX_ATTEMPTS) {
            console.log(`[audioUtils] Waiting ${RETRY_DELAY}ms before next check...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    } // End while loop

    if (!fileReady) {
      const errorMsg = `Selected file could not be verified in cache via JS FileSystem after ${MAX_ATTEMPTS} attempts. URI: ${pickedUri}`;
      console.error(`[audioUtils] ${errorMsg}`);
      Alert.alert('File Access Error', 'Could not verify the selected file after copying it. It might be corrupted, inaccessible, or the copy failed. Please try selecting the file again.');
      try { await FileSystem.deleteAsync(pickedUri, { idempotent: true }); } catch { /* ignore */ }
      return { canceled: true, message: 'File verification failed' };
    }
    // *** End Verification ***

    const currentFileUri = pickedUri; // Use the verified cache URI

    // Check if conversion to WAV is needed based on the *original* filename
    if (!isWavFile(originalName)) {
      console.log(`[audioUtils] File '${originalName}' is not WAV. Prompting for conversion.`);
      return new Promise((resolve) => {
        Alert.alert(
          'Format Conversion Required',
          'Transcription requires 16kHz WAV format. Convert this file?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => {
                console.log('[audioUtils] User cancelled conversion.');
                FileSystem.deleteAsync(currentFileUri, { idempotent: true }).catch(e => console.warn("Failed to delete cache file on cancel", e));
                resolve({ canceled: true, message: 'Conversion cancelled' });
              }
            },
            { text: 'Convert', onPress: async () => {
                try {
                  console.log(`[audioUtils] Starting conversion for URI: ${currentFileUri}`);
                  // Pass the verified cache URI to the conversion function (it handles path conversion)
                  const convertedUri = await convertToWavFormat(currentFileUri);
                  console.log(`[audioUtils] Conversion output URI: ${convertedUri}`);
                  // Clean up the intermediate (original format) cache file
                  FileSystem.deleteAsync(currentFileUri, { idempotent: true }).catch(e => console.warn("Failed to delete original cache file after conversion", e));
                  // Resolve with the NEW converted URI
                  resolve({
                    uri: convertedUri, // The URI of the converted WAV
                    name: `${originalName.split('.').slice(0, -1).join('.') || originalName}.wav`,
                    converted: true,
                    canceled: false
                  });
                } catch (error) {
                  console.error('[audioUtils] Conversion failed during prompt:', error);
                  Alert.alert('Conversion Failed', `Unable to convert the audio file: ${error.message}`);
                  FileSystem.deleteAsync(currentFileUri, { idempotent: true }).catch(e => console.warn("Failed to delete cache file on conversion error", e));
                  resolve({ canceled: true, message: `Conversion failed: ${error.message}` });
                }
              }
            }
          ]
        );
      });
    } else {
        console.log(`[audioUtils] File '${originalName}' is already WAV (based on extension). No conversion needed.`);
        // File is already WAV (or assumed to be), return its info
        return {
          uri: currentFileUri, // The verified cache URI
          name: originalName,
          converted: false,
          canceled: false
        };
    }

  } catch (error) {
    console.error('[audioUtils] Unexpected error in pickAudioFileForTranscription:', error);
    Alert.alert('File Selection Error', `An unexpected error occurred: ${error.message}`);
      return { canceled: true, message: `Unexpected error: ${error.message}` };
  }
};


// --- Audio Recording ---
export const startRecording = async () => {
  console.log('[audioUtils] Requesting audio permissions...');
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Microphone permission not granted');
  }
  console.log('[audioUtils] Permissions granted. Setting audio mode...');
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recordingOptions = getAudioRecordingOptions();
  const optionsToLog = Platform.OS === 'ios' ? recordingOptions.ios : recordingOptions;
  console.log('[audioUtils] Preparing to record with options:', optionsToLog);

  const recording = new Audio.Recording();
  try {
      await recording.prepareToRecordAsync(recordingOptions);
      console.log('[audioUtils] Starting recording...');
      await recording.startAsync();
      console.log('[audioUtils] Recording started.');
      return recording;
  } catch (error) {
      console.error('[audioUtils] Failed to prepare or start recording:', error);
      try { await recording.stopAndUnloadAsync(); } catch { /* ignore unload error */ }
      throw error;
  }
};

// --- Process Recording ---
// Handles stopping, getting URI, getting duration (with native fallback), and ensuring WAV format.
export const processRecordingForTranscription = async (recording) => {
  if (!recording) {
      console.error("[audioUtils] processRecording received null recording object.");
      throw new Error("Invalid recording object provided.");
  }
  console.log('[audioUtils] Processing recording...');

  let uri = null;
  let durationMillis = 0;

  try {
      // 1. Stop and Unload Recording
      console.log('[audioUtils] Attempting to stop and unload recording...');
      await recording.stopAndUnloadAsync();
      console.log('[audioUtils] Recording stopped and unloaded.');

      // 2. Get Recording URI
      uri = recording.getURI();
      if (!uri) {
          console.error("[audioUtils] Recording URI is null or undefined after stopAndUnloadAsync.");
          try { const finalStatus = await recording.getStatusAsync(); console.warn("[audioUtils] Final status after failed getURI:", finalStatus); } catch { /* ignore */ }
          throw new Error("Could not get recording URI after stopping.");
      }
      console.log(`[audioUtils] Got Recording URI: ${uri}`);

      // 3. Get Recording Duration (Try Expo AV first, then Native Fallback)
      console.log('[audioUtils] Attempting to get duration from Expo AV status...');
      try {
          const status = await recording.getStatusAsync(); // Get status AFTER unload
          // Use isLoaded check as duration might be present but recording not finalized
          if (status?.isLoaded === false && status?.durationMillis > 0) {
              durationMillis = status.durationMillis;
              console.log(`[audioUtils] Recording duration from status: ${durationMillis}ms`);
          } else {
              console.warn("[audioUtils] Could not get valid durationMillis from recording status:", status);
          }
      } catch(statusError) {
          console.warn("[audioUtils] Error getting recording status:", statusError);
      }

      // 4. Use Native Fallback if Expo AV failed
      if (durationMillis <= 0 && uri) { // Only run if needed AND uri is valid
          console.log('[audioUtils] Attempting native duration fallback...');
          try {
              // Pass URI to getAudioDuration (it handles path conversion)
              durationMillis = await getAudioDuration(uri);
              if (durationMillis > 0 && durationMillis !== 60000) { // Check if fallback didn't return default
                 console.log(`[audioUtils] Native fallback duration successful: ${durationMillis}ms`);
              } else if (durationMillis === 60000) {
                 console.warn(`[audioUtils] Native duration fallback returned default (60000ms). Actual duration might differ.`);
              } else {
                 console.warn(`[audioUtils] Native duration fallback returned invalid value (${durationMillis}ms). Using default.`);
                 durationMillis = 60000; // Assign default explicitly
              }
          } catch (nativeError) {
              console.error(`[audioUtils] Native duration fallback failed:`, nativeError);
              durationMillis = 60000; // Use default on error
          }
      } else if (durationMillis <= 0) {
        // If URI was null or fallback wasn't run/failed, ensure default
        console.error("[audioUtils] Cannot get duration: Status failed or URI invalid, and fallback failed/skipped. Using default 60000ms.");
        durationMillis = 60000;
      }

      // Ensure we have some positive duration
      if (durationMillis <= 0) {
          console.warn("[audioUtils] Duration is still non-positive after all checks. Setting to default 60000ms.");
          durationMillis = 60000;
      }


      // 5. Validate/Ensure WAV Format (Less likely needed if options are correct, but safe)
      if (!isWavFile(uri)) {
          console.warn(`[audioUtils] Recording URI '${uri}' is not WAV? Options might be incorrect. Attempting conversion...`);
          const convertedUri = await convertToWavFormat(uri); // Pass URI
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(e => console.warn("Failed to delete original recording file after conversion", e));
          console.log(`[audioUtils] Returning converted URI: ${convertedUri}`);
          return { uri: convertedUri, duration: durationMillis }; // Return URI and duration
      } else {
          console.log(`[audioUtils] Recording is already WAV: ${uri}. Duration: ${durationMillis}ms`);
          return { uri: uri, duration: durationMillis }; // Return original URI and duration
      }

  } catch (error) {
      console.error('[audioUtils] Error processing recording:', error);
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch { /* ignore */ }
      throw error; // Re-throw
  } finally {
      // Reset audio mode after processing is complete (success or caught error)
      try {
          console.log('[audioUtils] Resetting audio mode (allowsRecordingIOS: false)');
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch (audioModeError) {
          console.warn("[audioUtils] Could not reset audio mode:", audioModeError);
      }
  }
};


// --- Filesystem Utilities (Example) ---
// Accepts URI, lists based on Path
export const listDirectoryContents = async (directoryUri) => {
  const directoryPath = uriToPath(directoryUri);
  try {
    console.log(`[audioUtils] Listing contents of directory PATH: ${directoryPath}`);
    const info = await FileSystem.getInfoAsync(directoryUri); // getInfoAsync usually works with URI
    if (!info.exists || !info.isDirectory) {
        console.warn(`[audioUtils] Directory does not exist or is not a directory: ${directoryUri} (Path: ${directoryPath})`);
        return [];
    }
    // readDirectoryAsync needs URI
    const contents = await FileSystem.readDirectoryAsync(directoryUri);
    console.log(`[audioUtils] Contents of ${directoryUri} (JS):`, contents);
    return contents;
  } catch (error) {
    console.error(`[audioUtils] Error listing directory ${directoryUri} (Path: ${directoryPath}):`, error);
    return [];
  }
};

// --- Audio Utility Bridge ---
// Re-export the bridge if needed
export { default as AVFoundationAudio } from './AVFoundationAudio';

// --- EXPORT uriToPath --- ADD THIS LINE ---
export { uriToPath };
