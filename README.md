# native-whisper-transcription - iOS Audio Transcription with Whisper

**Status:** Active Development (April 2025)
**Platform:** iOS (Physical Device via Expo Dev Builds)

## Introduction

`native-whisper-transcription` is a React Native application built using the Expo framework (specifically leveraging Development Builds) designed to perform on-device audio transcription using OpenAI's Whisper model. It utilizes the `whisper.rn` library for the core transcription functionality and incorporates a custom native Swift module (`AVFoundationAudio`) to handle robust audio processing tasks on iOS.

The primary goal is to provide a reliable way to transcribe audio from device recordings or selected files, converting them to the required format (16kHz mono WAV) and handling long files efficiently through chunking.

## Features

* **Audio Input:**
    * Record audio directly within the app using `expo-av`.
    * Select existing audio files (e.g., M4A, MP3, WAV) from the device using `expo-document-picker`.
* **Native iOS Audio Processing (`AVFoundationAudio` Module):**
    * **Format Conversion:** Converts various common audio formats into the Whisper-required 16kHz, 16-bit, mono WAV format using Apple's native AVFoundation and AudioToolbox (`ExtAudioFile`) APIs for efficiency and reliability.
    * **Duration Calculation:** Provides a robust native method (`getAudioDuration`) to calculate audio duration, serving as a fallback when `expo-av` fails to report duration post-recording.
    * **Segment Extraction:** Extracts specific time segments from audio files (`extractAudioSegment`), enabling the chunking mechanism for long files.
* **Transcription Engine (`whisper.rn`):**
    * Performs local speech-to-text using the `whisper.cpp` library via `whisper.rn` bindings.
    * Supports loading different Whisper model files (e.g., `ggml-large-v3-q5_0.bin`, `ggml-large-v3-turbo-q5_0.bin`).
    * Utilizes **GPU acceleration** via Metal on iOS (`useGpu: true`) for significantly faster transcription.
* **Performance & UX:**
    * **Audio Chunking:** Implements an `AudioChunker.js` service to automatically split long audio files into smaller, overlapping segments for processing, preventing potential memory issues or timeouts with `whisper.rn`.
    * **Performance Profiles:** Allows selection between different modes (e.g., `balanced`, `fastest`) which configure the underlying Whisper model file and chunking parameters (`PerformanceProfiles.js`).
    * **Model Management:** Downloads required Whisper models on demand from Hugging Face, caches them in the app's `Documents` directory, and manages loading/releasing via `ModelManager.js`. Includes user prompts for large downloads.
    * **Native Logging Bridge:** A custom `RCTEventEmitter` bridge sends detailed logs (level, message, function, line, OSStatus) from the native Swift module to the JavaScript console for enhanced debugging.
    * **UI:** Displays transcription status, progress, results, and history.

## Project Status

* **Core Functionality:** Recording, file picking, native conversion, native duration/extraction, chunking, model management, transcription (direct and chunked), and performance mode switching (with caveats) are implemented and functional on iOS.
* **Build Method:** Developed and tested using Expo Development Builds (`npx expo run:ios --device`).
* **Known Issues:** See the dedicated [Known Issues & Workarounds](#known-issues--workarounds) section below, notably the crash related to releasing a used model context.

## Setup and Running

**Prerequisites:**

* npm or Yarn
* Expo CLI (`npm install -g expo-cli`)
* Xcode and Command Line Tools
* A physical iOS device (simulator support for native modules might vary, Metal requires a device).

**Installation:**

1.  Clone the repository.
2.  Navigate to the project directory: `cd native-whisper-transcription`
3.  Install dependencies: `npm install` or `yarn install`

**Running the Development Build:**

1.  Connect your physical iOS device via USB.
2.  Prebuild the ios project:
    ```bash
    npx expo prebuild --platform ios
    ```
    NOTE: Once built, you must navigate to `ios` directory and open the `*.xcworkspace` Xcode project. Once there, add `AVFoundationAudio.m` and `AVFoundationAudio.swift` (recommended to copy directly from github as these will be replaced every rebuild due to expo platform management) as new files into the current project through the GUI. Ensure they target the current project, and enable extended virtual addressing in the `Signing and Capabilities` tab. Add the following lines into the generated `*-Bridging-Header.h` found inside the ios/native-whisper-transcription directory: 
    ```cpp
    #import <React/RCTBridgeModule.h>
    #import <React/RCTEventEmitter.h>
    ```
3.  Build and launch the app on your device:
    ```bash
    npx expo run:ios --device
    ```
4.  The Expo Go app is **not** used; this command builds the native code (including the custom module) into a standalone development app (`.ipa`) installed on your device.
5.  The Metro bundler will start in the terminal. Keep it running. Logs from both JavaScript and the native module (via the event bridge) will appear here.

**Model Downloads:**

* The first time you select a performance mode (or on app start for the default mode), `ModelManager.js` will check if the required `.bin` file exists in the app's Documents directory.
* If the model is missing, it will prompt you to confirm the download (showing the size).
* Models are downloaded from Hugging Face via `expo-file-system`. Progress is shown in the status area.

## Architecture

The application combines React Native JavaScript logic with a custom native iOS module for specific audio processing tasks.

* **React Native Layer (Expo Dev Client):**
    * Manages UI components, application state (React Hooks), and user interactions.
    * Orchestrates the overall workflow: recording/picking -> processing -> transcription -> display.
    * `App.js`: Main component, state management, UI layout, button handlers.
    * `audioUtils.js`: Centralizes audio operations. Interfaces with `expo-av`, `expo-document-picker`, and the native bridge (`AVFoundationAudio.js`). Handles URI-to-path conversion needed for native calls and `whisper.rn`.
    * `AVFoundationAudio.js`: Simple JavaScript wrapper providing an async interface to the native Swift module methods, with basic platform checks and error logging.
    * `AudioChunker.js`: Class responsible for calculating audio chunks based on duration and profile settings, calling `audioUtils` (which uses the native module) to extract segments, managing transcription of individual chunks via `whisper.rn`, and merging results.
    * `ModelManager.js`: Handles the lifecycle of Whisper models – checking existence, downloading via `expo-file-system`, providing paths, loading via `initWhisper` (from `whisper.rn`), and releasing via `whisperContext.release()`.
    * `PerformanceProfiles.js`: Configuration object defining model files and parameters (chunk size, overlap) for different performance modes.
    * UI Components (`PerformanceModeSelector`, `ModelDownloadInfo`, etc.)
* **Native iOS Module (`AVFoundationAudio`):**
    * Written primarily in Swift (`AVFoundationAudio.swift`) with an Objective-C bridge file (`AVFoundationAudio.m`).
    * **Purpose:** To provide reliable and efficient audio processing using native APIs, specifically:
        * Converting audio to 16kHz mono WAV via `ExtAudioFile` (AudioToolbox).
        * Getting accurate duration via `AVAsset` or `AudioFile` APIs.
        * Extracting segments efficiently using `AVAssetReader` and `AVAssetWriter`.
    * **Logging:** Implements `RCTEventEmitter` to bridge native `print`-style logs back to the JavaScript console via `NativeLogEvent`, crucial for debugging native operations within the Expo ecosystem.
    * **Bridging:** Uses `MyWhisperApp-Bridging-Header.h` to expose necessary React Native Objective-C headers to Swift.
* **Core Transcription Library (`whisper.rn`):**
    * Provides the `initWhisper` function to load models and the `whisperContext.transcribe()` method to perform transcription.
    * Internally uses `whisper.cpp` compiled for iOS.
    * Handles GPU acceleration via Metal when `useGpu: true` is specified.

## Native Module Details (`AVFoundationAudio`)

This custom module was created to overcome limitations and ensure robustness in audio handling:

* **`convertToWavFormat(sourcePath, outputPath)`:** Uses the `ExtAudioFile` API from AudioToolbox. This low-level API allows reading from various source formats and writing to a specified destination format (16kHz, 16-bit, mono PCM WAV in this case) with internal conversion.
* **`getAudioDuration(filePath)`:** Primarily uses `AVAsset.load(.duration)`. Includes a fallback using `AudioFileGetProperty(kAudioFilePropertyEstimatedDuration)` for cases where `AVAsset` might fail or return invalid durations. Returns duration in milliseconds.
* **`extractAudioSegment(sourcePath, outputPath, startMs, durationMs)`:** Uses `AVAssetReader` configured with the target output settings (16kHz mono WAV) and the specified `timeRange`. An `AVAssetWriter` writes the processed samples read from the reader to the `outputPath`. This performs both extraction and format conversion/resampling in one efficient pass.
* **Threading:** Native operations involving significant processing (conversion, extraction) are wrapped in `Task` blocks in Swift to avoid blocking the main React Native bridge thread, although the underlying AVFoundation/AudioToolbox work might still be CPU-intensive.
* **Error Handling:** Native functions attempt to return specific error codes/messages via Promise rejections. OSStatus codes are included in native logs for deeper debugging.
* **Path Handling:** Expects standard POSIX file paths (e.g., `/var/mobile/...`) as input from JavaScript. The `audioUtils.js` layer is responsible for converting `file://` URIs to paths before calling the native module.

## Known Issues & Workarounds

1.  **CRITICAL: Crash on Releasing Used Model Context (`whisper.rn` Bug?)**
    * **Symptom:** The application crashes reliably when switching performance modes *after* the currently loaded model has been used to perform at least one transcription. Switching between models that have been loaded but *not* used for transcription works without issues.
    * **Diagnosis:** JS logs show the crash occurs immediately after attempting to release the model (`Releasing current model: ...` log appears, but subsequent logs/operations do not). The native iOS crash log (`.ips` file) indicates `bug_type: 309` and `asi: {"libsystem_malloc.dylib": ["BUG IN CLIENT OF LIBMALLOC: memory corruption of free block"]}`. The exception type is `EXC_BREAKPOINT (SIGTRAP)`.
    * **Hypothesis:** This strongly indicates that the native `whisperContext.release()` function (called via `ModelManager.js`) corrupts heap memory when invoked on a context that has previously executed `transcribe()`. The transcription process likely leaves native resources (potentially related to memory buffers or GPU/Metal states used during computation) in an inconsistent state. The `release()` function then accesses/frees invalid memory, leading to corruption detected later by the system memory allocator, causing the `SIGTRAP`. This issue appears correlated with GPU usage (`useGpu: true`).
    * **Workaround:** **Avoid switching performance modes after performing a transcription.** Choose a desired mode at the start of the session and stick with it.
    * **Status:** Believed to be a bug within the `whisper.rn` library or its underlying `whisper.cpp` dependency concerning resource cleanup after transcription, especially with GPU acceleration. Recommend testing without GPU to confirm correlation and reporting the detailed findings (sequence, JS logs, full `.ips` crash log) to the `whisper.rn` project maintainers.

2.  **Expo AV Recording Duration:** `Audio.Recording.getStatusAsync()` consistently returns `durationMillis: 0` after `stopAndUnloadAsync()` on iOS, making it unreliable for getting the recording length immediately.
    * **Workaround:** Implemented a fallback in `audioUtils.js` (`processRecordingForTranscription`) that calls the custom native module's `getAudioDuration` function, which now works reliably.

3.  **Metro Bundler Model `require` Warning:**
    * **Symptom:** `WARN Could not reference model files directly via require: Requiring unknown module "undefined".`
    * **Status:** This is a benign warning. It occurs because the JavaScript `require` function cannot directly bundle large binary model files referenced in `ensureModelsIncluded`. This is expected behavior as models are handled via native assets or downloads managed by `ModelManager.js`. Transcription functionality is unaffected.

## Future Work / Improvements

* **Investigate & Fix Crash:** Collaborate with `whisper.rn` maintainers or investigate the native code further to fix the resource cleanup issue causing the crash on release.
* **Android Support:** Implement a corresponding native module for Android using its media APIs (e.g., `MediaCodec`, `MediaExtractor`) or explore cross-platform C++ solutions for audio processing.
* **Real-time Transcription:** Explore microphone streaming and incremental transcription for live feedback.
* **Diarization:** Integrate speaker identification capabilities (may require different models or post-processing).
* **Translation:** Leverage Whisper's translation features.
* **Chunk Merging:** Implement more sophisticated overlap analysis and merging in `AudioChunker.js` for potentially more seamless results across chunk boundaries.
* **Error Handling:** Add more granular error handling and user-friendly feedback for download failures, native errors, etc.
* **UI/UX:** Improve visual design, progress indicators, and overall user experience.
* **Model Storage Management:** Add features to view storage usage and selectively delete unused models.
* **Native File Management:** Consider moving custom native source files (`.m`, `.swift`, `.h`) outside the auto-generated `ios` directory (e.g., into a top-level `native-modules` folder) and use an Expo Config Plugin to manage linking and bridging header modification, making the setup more resilient to `prebuild --clean`.

## License

MIT License