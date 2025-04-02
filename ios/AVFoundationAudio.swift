import Foundation
@preconcurrency import AVFoundation
import AudioToolbox
import React // Import React for RCTEventEmitter
import CoreServices

// Helper function to pretty-print AudioStreamBasicDescription
func formatASBD(_ asbd: AudioStreamBasicDescription) -> String {
    // Convert formatID to a readable string (if possible)
    let formatIDInt = asbd.mFormatID
    let formatIDChars = String(
        bytes: [
            UInt8((formatIDInt >> 24) & 0xFF),
            UInt8((formatIDInt >> 16) & 0xFF),
            UInt8((formatIDInt >> 8) & 0xFF),
            UInt8(formatIDInt & 0xFF)
        ],
        encoding: .macOSRoman
    )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "\(formatIDInt)"

    // Format flags nicely if possible (add common flags as needed)
    var flagsStr = "\(asbd.mFormatFlags)"
    if asbd.mFormatID == kAudioFormatLinearPCM {
        var pcmFlags: [String] = []
        if (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 { pcmFlags.append("Float") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsBigEndian) != 0 { pcmFlags.append("BigEndian") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0 { pcmFlags.append("SignedInt") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsPacked) != 0 { pcmFlags.append("Packed") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsAlignedHigh) != 0 { pcmFlags.append("AlignedHigh") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0 { pcmFlags.append("NonInterleaved") }
        if (asbd.mFormatFlags & kAudioFormatFlagIsNonMixable) != 0 { pcmFlags.append("NonMixable") }
        if !pcmFlags.isEmpty {
            flagsStr = pcmFlags.joined(separator: " | ") + " (\(asbd.mFormatFlags))"
        }
    }


    return """
        Sample Rate:       \(asbd.mSampleRate) Hz
        Format ID:         \(formatIDChars) (\(asbd.mFormatID))
        Format Flags:      \(flagsStr)
        Bytes per Packet:  \(asbd.mBytesPerPacket)
        Frames per Packet: \(asbd.mFramesPerPacket)
        Bytes per Frame:   \(asbd.mBytesPerFrame)
        Channels per Frame:\(asbd.mChannelsPerFrame)
        Bits per Channel:  \(asbd.mBitsPerChannel)
    """
}


// Inherit from RCTEventEmitter to send events to JavaScript
@objc(AVFoundationAudio)
class AVFoundationAudio: RCTEventEmitter {

    private var hasListeners = false // Track if JS is listening

    // Centralized logging function - sends events to JS if listeners are attached
    private func log(_ message: String,
                     level: String = "INFO",
                     osStatusCode: OSStatus? = nil,
                     function: String = #function,
                     line: Int = #line) {

        // Always print to Xcode console regardless of JS listeners for easier native debugging
         print("[AVFoundationAudio-Native] [\(level)] [\(URL(fileURLWithPath: function).lastPathComponent):\(line)] \(message)" + (osStatusCode != nil ? " (OSStatus: \(osStatusCode!))" : ""))

        // Only construct and send the event if JS is actively listening
        guard hasListeners, let bridge = self.bridge else {
            // No JS listener attached
            return
        }

        // Prepare payload for the event
        var body: [String: Any] = [
            "level": level.uppercased(), // Ensure consistent casing
            "message": message,
            // Use filename instead of full path for function if possible
            "function": URL(fileURLWithPath: function).lastPathComponent,
            "line": line
        ]

        if let code = osStatusCode {
            body["osStatus"] = code
        }

        // Send the event over the bridge
        // Ensure this happens on the correct queue if necessary, though sendEvent is generally safe.
        self.sendEvent(withName: "NativeLogEvent", body: body)
    }

    // --- RCTEventEmitter Overrides ---

    override func supportedEvents() -> [String]! {
      return ["NativeLogEvent"]
    }

    override func startObserving() {
        hasListeners = true
        // Use direct print here, log() checks hasListeners
        print("[AVFoundationAudio-Native] Start observing: JavaScript listener attached.")
    }

    override func stopObserving() {
        hasListeners = false
         print("[AVFoundationAudio-Native] Stop observing: JavaScript listener detached.")
    }

    // --- React Native Module Setup ---

    override static func requiresMainQueueSetup() -> Bool {
        print("[AVFoundationAudio-Native] requiresMainQueueSetup called")
        return false // Background thread setup is fine
    }

    // --- Helper: List Directory Contents ---
    // For debugging file existence issues
    private func logDirectoryContents(forPath path: String) {
        let directoryPath = (path as NSString).deletingLastPathComponent
        log("Attempting to list contents of directory: \(directoryPath)", level: "VERBOSE")
        do {
            let items = try FileManager.default.contentsOfDirectory(atPath: directoryPath)
            log("Contents of '\(directoryPath)': \(items)", level: "DEBUG")
        } catch {
            log("Failed to list directory '\(directoryPath)': \(error.localizedDescription)", level: "WARN")
        }
    }

    // --- Exposed Native Methods ---

    @objc func getAudioDuration(_ filePath: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        log("getAudioDuration received path parameter: '\(filePath)'", level: "DEBUG")

        // ** Crucial: Use the received filePath directly **
        // Assuming JS now sends a POSIX path, not a file:// URI
        let pathToCheck = filePath

        // Debug: Log directory contents before checking file existence
        logDirectoryContents(forPath: pathToCheck)

        log("Checking existence using FileManager.default.fileExists(atPath: '\(pathToCheck)')", level: "DEBUG")
        guard FileManager.default.fileExists(atPath: pathToCheck) else {
            let errMsg = "File does not exist at path: \(pathToCheck)"
            log(errMsg, level: "ERROR")
            reject("FILE_NOT_FOUND", errMsg, NSError(domain: "AVFoundationAudio", code: 404, userInfo: [NSLocalizedDescriptionKey: errMsg]))
            return
        }

        let url = URL(fileURLWithPath: pathToCheck) // Use the verified path
        let asset = AVAsset(url: url)

        Task { // Perform AVAsset loading asynchronously
            log("Starting async duration loading task for: \(url.path)", level: "DEBUG")
            do {
                log("Awaiting asset.load(.duration)...", level: "VERBOSE")
                let duration = try await asset.load(.duration)
                var durationSeconds = CMTimeGetSeconds(duration)
                log("AVAsset duration raw value: \(durationSeconds) seconds", level: "VERBOSE")

                if durationSeconds.isNaN || durationSeconds.isInfinite || durationSeconds <= 0 {
                    log("AVAsset duration is invalid (\(durationSeconds)). Attempting fallback with AudioFile.", level: "WARN")
                    durationSeconds = await getDurationWithAudioFile(url: url) ?? -1.0

                    if durationSeconds <= 0 {
                        log("Fallback duration check also failed or returned invalid duration. Resolving with default 60000ms.", level: "WARN")
                        resolve(60000) // Default 1 minute if both methods fail
                        return
                    }
                     log("Fallback duration check successful: \(durationSeconds) seconds.", level: "INFO")
                }

                let durationMs = durationSeconds * 1000
                log("Successfully obtained duration: \(durationMs) ms")
                resolve(durationMs)

            } catch {
                let errorDescription = error.localizedDescription
                log("AVAsset.load(.duration) threw error: \(errorDescription). Trying fallback.", level: "ERROR")
                let fallbackDurationSeconds = await getDurationWithAudioFile(url: url) ?? -1.0

                 if fallbackDurationSeconds > 0 {
                    let durationMs = fallbackDurationSeconds * 1000
                    log("Successfully obtained duration via fallback after error: \(durationMs) ms")
                    resolve(durationMs)
                 } else {
                    let errMsg = "Failed to get duration after AVAsset load error and fallback failure: \(errorDescription)"
                    log(errMsg, level: "ERROR")
                    // Resolve with default instead of rejecting? Or reject as before? Let's resolve with default.
                    log("Resolving with default 60000ms after all duration attempts failed.", level: "WARN")
                    resolve(60000);
                    // reject("DURATION_ERROR", errMsg, error) // Original rejection
                 }
            }
        }
    }


    @objc func extractAudioSegment(_ sourcePath: String,
                                 outputPath: String,
                                 startMs: Double,
                                 durationMs: Double,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        log("extractAudioSegment received parameters: Source='\(sourcePath)', Output='\(outputPath)', Start=\(startMs)ms, Duration=\(durationMs)ms", level: "DEBUG")

        // ** Crucial: Use received paths directly **
        let pathToCheck = sourcePath
        let pathToWrite = outputPath

        // Debug: Log directory contents before checking file existence
        logDirectoryContents(forPath: pathToCheck)

        log("Checking source existence using FileManager.default.fileExists(atPath: '\(pathToCheck)')", level: "DEBUG")
        guard FileManager.default.fileExists(atPath: pathToCheck) else {
            let errMsg = "Source file does not exist at path: \(pathToCheck)"
            log(errMsg, level: "ERROR")
            reject("FILE_NOT_FOUND", errMsg, NSError(domain: "AVFoundationAudio", code: 404, userInfo: [NSLocalizedDescriptionKey: errMsg]))
            return
        }

        do {
            let destinationURL = URL(fileURLWithPath: pathToWrite)
            let outputDir = destinationURL.deletingLastPathComponent()

            log("Ensuring output directory exists: \(outputDir.path)", level: "VERBOSE")
            try FileManager.default.createDirectory(
                at: outputDir,
                withIntermediateDirectories: true
            )

            if FileManager.default.fileExists(atPath: pathToWrite) {
                log("Removing existing output file at: \(pathToWrite)", level: "WARN")
                try FileManager.default.removeItem(atPath: pathToWrite)
            }

            log("Starting async segment extraction task...")
            Task {
                 // Call async helper using the verified paths
                 let success = await extractSegment(sourcePath: pathToCheck,
                                                    destinationPath: pathToWrite,
                                                    startMs: startMs,
                                                    durationMs: durationMs)
                if success {
                    log("Segment extraction task completed successfully. Output: \(pathToWrite)")
                    resolve(pathToWrite) // Resolve with the output PATH
                } else {
                    let errMsg = "Failed to extract audio segment. Check native logs for specific error details."
                    log(errMsg, level: "ERROR")
                    reject("EXTRACTION_ERROR", errMsg, nil)
                }
            }
        } catch {
             let errorDescription = error.localizedDescription
             let errMsg = "Error preparing for extraction (file operations): \(errorDescription)"
             log(errMsg, level: "ERROR")
            reject("PREPARATION_ERROR", errMsg, error)
        }
    }


    @objc func convertToWavFormat(_ sourcePath: String,
                                  outputPath: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        log("convertToWavFormat received parameters: Source='\(sourcePath)', Output='\(outputPath)'", level: "DEBUG")

        // ** Crucial: Use received paths directly **
        let pathToCheck = sourcePath
        let pathToWrite = outputPath

        // Debug: Log directory contents before checking file existence
        logDirectoryContents(forPath: pathToCheck)

        log("Checking source existence using FileManager.default.fileExists(atPath: '\(pathToCheck)')", level: "DEBUG")
        guard FileManager.default.fileExists(atPath: pathToCheck) else {
            let errMsg = "Source file does not exist at path: \(pathToCheck)"
            log(errMsg, level: "ERROR")
            reject("FILE_NOT_FOUND", errMsg, NSError(domain: "AVFoundationAudio", code: 404, userInfo: [NSLocalizedDescriptionKey: errMsg]))
            return
        }

        do {
            let destinationURL = URL(fileURLWithPath: pathToWrite)
            let outputDir = destinationURL.deletingLastPathComponent()

            log("Ensuring output directory exists: \(outputDir.path)", level: "VERBOSE")
            try FileManager.default.createDirectory(
                at: outputDir,
                withIntermediateDirectories: true
            )

            if FileManager.default.fileExists(atPath: pathToWrite) {
                log("Removing existing output file at: \(pathToWrite)", level: "WARN")
                try FileManager.default.removeItem(atPath: pathToWrite)
            }

            log("Starting conversion task (using synchronous helper simpleConvertToWav)...")
            // Use Task to avoid blocking JS thread, even though helper is sync
            Task(priority: .userInitiated) {
                 // Call the helper using verified paths
                 let conversionResult: OSStatus? = simpleConvertToWav(sourcePath: pathToCheck, outputPath: pathToWrite)

                if let errorCode = conversionResult {
                    // Failure
                    let jsErrorMessage = "Failed to convert file to WAV."
                    let detailedLogMessage = "\(jsErrorMessage) OSStatus code: \(errorCode)."
                    let errorInfo = [NSLocalizedDescriptionKey: detailedLogMessage]
                    let error = NSError(domain: "AVFoundationAudioConversionError", code: Int(errorCode), userInfo: errorInfo)

                    // Log the detailed error via event BEFORE rejecting the promise
                    log(detailedLogMessage, level: "ERROR", osStatusCode: errorCode)
                    reject("CONVERSION_ERROR", jsErrorMessage, error)
                } else {
                    // Success
                    log("Conversion task completed successfully. Output: \(pathToWrite)")
                    resolve(pathToWrite) // Resolve with the output PATH
                }
            }
        } catch {
             let errorDescription = error.localizedDescription
            let prepErrorMessage = "Error preparing for conversion (file operations): \(errorDescription)"
             log(prepErrorMessage, level: "ERROR")
            reject("PREPARATION_ERROR", prepErrorMessage, error)
        }
    }


    @objc func isWavFormat(_ filePath: String,
                           resolver resolve: RCTPromiseResolveBlock,
                           rejecter reject: RCTPromiseRejectBlock) {
        log("isWavFormat called for path: '\(filePath)'", level: "DEBUG")
        // Simple extension check is usually sufficient and fast
        let pathToCheck = filePath // Assuming JS sends path
        let isWav = pathToCheck.lowercased().hasSuffix(".wav")
        log("Result (extension check): \(isWav)")
        resolve(isWav)
        // Note: A more robust check could involve opening the file and reading headers,
        // but that's slower and likely overkill if isWavFile in JS is the primary gate.
    }

    // MARK: - Private Helper Methods (Duration Fallback) -

    private func getDurationWithAudioFile(url: URL) async -> Double? {
        log("Attempting duration fallback using AudioFile for URL: \(url.path)", level: "DEBUG")
        var audioFileID: AudioFileID?
        var status: OSStatus = noErr

        status = AudioFileOpenURL(url as CFURL, .readPermission, 0, &audioFileID)
        guard status == noErr, let validAudioFileID = audioFileID else {
            log("AudioFileOpenURL failed.", level: "ERROR", osStatusCode: status)
            return nil
        }
        log("AudioFile opened successfully.", level: "VERBOSE")
        defer {
            log("Closing AudioFile.", level: "VERBOSE")
            AudioFileClose(validAudioFileID)
        }

        var duration: TimeInterval = 0
        var propertySize: UInt32 = UInt32(MemoryLayout<TimeInterval>.size)
        log("Getting kAudioFilePropertyEstimatedDuration...", level: "VERBOSE")
        status = AudioFileGetProperty(validAudioFileID, kAudioFilePropertyEstimatedDuration, &propertySize, &duration)

        guard status == noErr else {
            log("AudioFileGetProperty(kAudioFilePropertyEstimatedDuration) failed.", level: "ERROR", osStatusCode: status)
            return nil
        }
        log("AudioFile duration property retrieved: \(duration) seconds", level: "VERBOSE")

        if duration > 0 {
            log("AudioFile fallback duration check successful.")
            return duration
        } else {
             log("AudioFile fallback returned non-positive duration (\(duration)).", level: "WARN")
             return nil
        }
    }


    // MARK: - Private Helper Methods (Extraction - AVAssetReader/Writer) -

    // Async extract segment helper - uses Paths, returns true if successful
    private func extractSegment(sourcePath: String, destinationPath: String, startMs: Double, durationMs: Double) async -> Bool {
        log("Starting extractSegment helper.", level: "DEBUG")
        log("Parameters: Source Path='\(sourcePath)', Dest Path='\(destinationPath)', Start=\(startMs)ms, Duration=\(durationMs)ms", level: "VERBOSE")

        let sourceURL = URL(fileURLWithPath: sourcePath)
        let destinationURL = URL(fileURLWithPath: destinationPath)
        let asset = AVAsset(url: sourceURL)

        var audioTrack: AVAssetTrack?
         do {
             log("Loading audio tracks for asset...", level: "VERBOSE")
             // Prefer loading tracks with specific media type first
             let tracks = try await asset.loadTracks(withMediaType: .audio)
             if let track = tracks.first {
                 audioTrack = track
                 log("Found audio track with media type .audio.", level: "DEBUG")
             } else {
                  log("No explicit .audio track found, checking all tracks...", level: "WARN")
                  let allTracks = try await asset.load(.tracks) // Load generic tracks property
                  audioTrack = allTracks.first // Take the first track if any exist
                  if audioTrack != nil {
                      log("Using first available track (type: \(audioTrack?.mediaType.rawValue ?? "unknown")).", level: "DEBUG")
                  }
             }

             guard audioTrack != nil else {
                 log("No suitable track found in the asset.", level: "ERROR")
                 return false
             }
             log("Audio track successfully loaded.", level: "DEBUG")
         } catch {
              let errorDescription = error.localizedDescription
             log("Error loading tracks: \(errorDescription)", level: "ERROR")
             return false
         }

        guard let validAudioTrack = audioTrack else {
            log("Valid audio track is unexpectedly nil after loading check.", level: "ERROR")
            return false
        }

        do {
             log("Setting up AVAssetReader...", level: "DEBUG")
            let reader = try AVAssetReader(asset: asset)

            let startTime = CMTime(seconds: startMs / 1000.0, preferredTimescale: 1000)
            let durationTime = CMTime(seconds: durationMs / 1000.0, preferredTimescale: 1000)
            let timeRange = CMTimeRange(start: startTime, duration: durationTime)
            reader.timeRange = timeRange
             log("Reader time range set: Start=\(CMTimeGetSeconds(startTime))s, Duration=\(CMTimeGetSeconds(durationTime))s", level: "DEBUG")


            let outputSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16000.0,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false
            ]
            log("Reader output settings configured for 16kHz/16bit/Mono PCM.", level: "DEBUG")

            let readerOutput = AVAssetReaderTrackOutput(track: validAudioTrack, outputSettings: outputSettings)
            readerOutput.alwaysCopiesSampleData = false
            if reader.canAdd(readerOutput) {
                 reader.add(readerOutput)
                 log("AVAssetReaderTrackOutput added to reader.", level: "DEBUG")
            } else {
                 log("Cannot add reader output. Reader status: \(reader.status.rawValue), Error: \(reader.error?.localizedDescription ?? "N/A")", level: "ERROR")
                 return false
            }

             log("Setting up AVAssetWriter for WAV output at \(destinationPath)...", level: "DEBUG")
            let writer = try AVAssetWriter(outputURL: destinationURL, fileType: .wav)
            let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: outputSettings)
            writerInput.expectsMediaDataInRealTime = false
             if writer.canAdd(writerInput) {
                 writer.add(writerInput)
                 log("AVAssetWriterInput added to writer.", level: "DEBUG")
            } else {
                 log("Cannot add writer input. Writer status: \(writer.status.rawValue), Error: \(writer.error?.localizedDescription ?? "N/A")", level: "ERROR")
                 return false
            }

            log("Starting reader reading process...", level: "DEBUG")
            if !reader.startReading() {
                log("Failed to start reader. Status: \(reader.status.rawValue), Error: \(reader.error?.localizedDescription ?? "N/A")", level: "ERROR")
                return false
            }
             log("Reader started. Status: \(reader.status.rawValue)", level: "INFO")

             log("Starting writer writing process...", level: "DEBUG")
            if !writer.startWriting() {
                log("Failed to start writer. Status: \(writer.status.rawValue), Error: \(writer.error?.localizedDescription ?? "N/A")", level: "ERROR")
                if reader.status == .reading { reader.cancelReading() }
                return false
            }
            log("Writer started. Status: \(writer.status.rawValue)", level: "INFO")


             log("Starting writer session at source time: \(CMTimeGetSeconds(timeRange.start))s", level: "DEBUG")
            writer.startSession(atSourceTime: timeRange.start)

             log("Starting sample processing loop...", level: "DEBUG")
             let success = await processSamples(readerOutput: readerOutput, writerInput: writerInput, reader: reader, writer: writer)
             log("Sample processing loop finished with result: \(success)", level: "DEBUG")


             guard reader.status != .failed && reader.status != .cancelled &&
                   writer.status != .failed && writer.status != .cancelled else {
                 log("Reader (\(reader.status.rawValue)) or Writer (\(writer.status.rawValue)) in failed/cancelled state before finishing.", level: "ERROR")
                 if writer.status == .writing { writer.cancelWriting() }
                 if reader.status == .reading { reader.cancelReading() }
                 return false
             }

             if success && writer.status == .writing {
                 log("Processing loop successful. Attempting to finish writing...", level: "DEBUG")
                 await writer.finishWriting()
                 if writer.status == .completed {
                      log("Writer finished writing successfully. Status: \(writer.status.rawValue)", level: "INFO")
                     return true
                 } else {
                     let errorDescription = writer.error?.localizedDescription ?? "N/A"
                     log("Writer failed final finishWriting. Status: \(writer.status.rawValue), Error: \(errorDescription)", level: "ERROR")
                     return false
                 }
             } else {
                 log("Extraction failed or writer not in correct state. Processing Success=\(success), Reader Status=\(reader.status.rawValue), Writer Status=\(writer.status.rawValue)", level: "ERROR")
                 if writer.status == .writing { writer.cancelWriting() }
                 if reader.status == .reading { reader.cancelReading() }
                 return false
             }

        } catch {
             let errorDescription = error.localizedDescription
            log("Error during reader/writer setup: \(errorDescription)", level: "ERROR")
            return false
        }
    }

    // Helper function to process audio samples asynchronously using continuation
    private func processSamples(readerOutput: AVAssetReaderTrackOutput, writerInput: AVAssetWriterInput, reader: AVAssetReader, writer: AVAssetWriter) async -> Bool {
        log("processSamples starting.", level: "DEBUG")
        return await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "com.avfoundationaudio.sampleprocessing")
            log("Requesting media data on queue: \(queue.label)", level: "DEBUG")

            writerInput.requestMediaDataWhenReady(on: queue) { [weak self] in
                 guard let self = self else {
                     print("[AVFoundationAudio-Native] Error: self is nil in requestMediaDataWhenReady callback.")
                     continuation.resume(returning: false)
                     return
                 }

                 self.log("requestMediaDataWhenReady callback triggered. writerInput.isReady=\(writerInput.isReadyForMoreMediaData)", level: "VERBOSE")
                 while writerInput.isReadyForMoreMediaData {
                      if reader.status == .failed || reader.status == .cancelled {
                           self.log("Reader entered failed/cancelled state (\(reader.status.rawValue)) within loop. Aborting.", level: "WARN")
                           continuation.resume(returning: false)
                           return
                       }
                       if writer.status == .failed || writer.status == .cancelled {
                           self.log("Writer entered failed/cancelled state (\(writer.status.rawValue)) within loop. Aborting.", level: "WARN")
                           continuation.resume(returning: false)
                           return
                       }

                      // self.log("Attempting to copy next sample buffer...", level: "VERBOSE") // Too noisy
                      if let sampleBuffer = readerOutput.copyNextSampleBuffer() {
                           // self.log("Sample buffer copied. Appending...", level: "VERBOSE") // Too noisy
                           if !writerInput.append(sampleBuffer) {
                                let errorDescription = writer.error?.localizedDescription ?? "N/A"
                                self.log("Failed to append sample buffer. Writer status: \(writer.status.rawValue), Error: \(errorDescription)", level: "ERROR")
                                if reader.status == .reading { reader.cancelReading() }
                                continuation.resume(returning: false)
                                return
                           }
                      } else {
                           self.log("copyNextSampleBuffer returned nil. Reader status: \(reader.status.rawValue).", level: "DEBUG")
                           if reader.status == .completed {
                                self.log("Reader completed. Marking writer input as finished.", level: "INFO")
                                writerInput.markAsFinished()
                                continuation.resume(returning: true)
                           } else if reader.status == .failed {
                               let errorDescription = reader.error?.localizedDescription ?? "N/A"
                                self.log("Reader failed. Error: \(errorDescription)", level: "ERROR")
                                if writer.status == .writing { writer.cancelWriting() }
                                continuation.resume(returning: false)
                           } else if reader.status == .cancelled {
                                self.log("Reader was cancelled.", level: "WARN")
                                if writer.status == .writing { writer.cancelWriting() }
                                continuation.resume(returning: false)
                           } else {
                                self.log("Reader finished reading samples for time range or has unknown status (\(reader.status.rawValue)). Marking writer as finished.", level: "INFO")
                                writerInput.markAsFinished()
                                continuation.resume(returning: true)
                           }
                           return
                      }
                 }
                 self.log("Exited loop: writerInput not ready for more data. Waiting for next callback...", level: "VERBOSE")
            }
        }
    }


    // MARK: - Private Helper Methods (Conversion - ExtAudioFile) -

    // Synchronous WAV conversion using ExtAudioFile APIs - uses Paths
    // Returns nil on success, OSStatus code on failure
    private func simpleConvertToWav(sourcePath: String, outputPath: String) -> OSStatus? {
        log("Starting simpleConvertToWav helper.", level: "DEBUG")
        log("Parameters: Source Path='\(sourcePath)', Dest Path='\(outputPath)'", level: "VERBOSE")

        let sourceURL = URL(fileURLWithPath: sourcePath)
        let destinationURL = URL(fileURLWithPath: outputPath)

        var error: OSStatus = noErr
        var sourceFile: ExtAudioFileRef?
        var destinationFile: ExtAudioFileRef?
        var buffer: UnsafeMutableRawPointer? = nil // For manual memory management

        defer {
            if let sf = sourceFile { ExtAudioFileDispose(sf) }
            if let df = destinationFile { ExtAudioFileDispose(df) }
            if let buf = buffer { free(buf) }
            print("[AVFoundationAudio-Native] Deferred cleanup executed for simpleConvertToWav.")
        }

        do {
             log("Attempting ExtAudioFileOpenURL for source: \(sourcePath)", level: "VERBOSE")
            error = ExtAudioFileOpenURL(sourceURL as CFURL, &sourceFile)
            if error != noErr || sourceFile == nil {
                log("Error opening source file.", level: "ERROR", osStatusCode: error)
                return error
            }
            log("Source file opened successfully.", level: "DEBUG")

            var sourceFormat = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            log("Getting source file data format property...", level: "VERBOSE")
            error = ExtAudioFileGetProperty(sourceFile!, kExtAudioFileProperty_FileDataFormat, &size, &sourceFormat)
            if error != noErr {
                log("Could not get source file data format.", level: "WARN", osStatusCode: error)
            } else {
                 log("Source Format Details:\n\(formatASBD(sourceFormat))", level: "DEBUG")
            }

            var destinationFormat = AudioStreamBasicDescription()
            destinationFormat.mSampleRate = 16000.0
            destinationFormat.mFormatID = kAudioFormatLinearPCM
            destinationFormat.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked
            destinationFormat.mBitsPerChannel = 16
            destinationFormat.mChannelsPerFrame = 1 // Mono
            destinationFormat.mFramesPerPacket = 1
            destinationFormat.mBytesPerFrame = (destinationFormat.mBitsPerChannel / 8) * destinationFormat.mChannelsPerFrame
            destinationFormat.mBytesPerPacket = destinationFormat.mBytesPerFrame * destinationFormat.mFramesPerPacket
            destinationFormat.mReserved = 0
            log("Defined Destination Format (PCM 16kHz/16bit/Mono):\n\(formatASBD(destinationFormat))", level: "DEBUG")


            size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            log("Setting client data format (destination format) on source file...", level: "VERBOSE")
            error = ExtAudioFileSetProperty(sourceFile!, kExtAudioFileProperty_ClientDataFormat, size, &destinationFormat)
            if error != noErr {
                 log("Error setting client data format on source file.", level: "ERROR", osStatusCode: error)
                return error
            }
             log("Client data format set successfully on source.", level: "DEBUG")

             log("Attempting ExtAudioFileCreateWithURL for destination WAV: \(outputPath)", level: "VERBOSE")
            error = ExtAudioFileCreateWithURL(destinationURL as CFURL,
                                              kAudioFileWAVEType,
                                              &destinationFormat,
                                              nil,
                                              AudioFileFlags.eraseFile.rawValue,
                                              &destinationFile)
            if error != noErr || destinationFile == nil {
                 log("Error creating destination WAV file.", level: "ERROR", osStatusCode: error)
                return error
            }
            log("Destination WAV file created successfully.", level: "DEBUG")

            log("Setting client data format on destination file...", level: "VERBOSE")
            error = ExtAudioFileSetProperty(destinationFile!, kExtAudioFileProperty_ClientDataFormat, size, &destinationFormat)
            if error != noErr {
                log("Error setting client data format on destination file.", level: "ERROR", osStatusCode: error)
                return error
            }
            log("Client data format set successfully on destination.", level: "DEBUG")


            let bufferSize: UInt32 = 32768
            log("Allocating conversion buffer (size: \(bufferSize) bytes)...", level: "DEBUG")
            buffer = malloc(Int(bufferSize))
             guard buffer != nil else {
                 log("Failed to allocate memory for buffer", level: "ERROR")
                 return kAudio_MemFullError // Use standard OSStatus code for memory error
             }
             log("Buffer allocated successfully.", level: "DEBUG")
            var convertedData = AudioBufferList(
                mNumberBuffers: 1,
                mBuffers: AudioBuffer(
                    mNumberChannels: destinationFormat.mChannelsPerFrame,
                    mDataByteSize: bufferSize,
                    mData: buffer
                )
            )

            log("Starting ExtAudioFile read/write conversion loop...", level: "DEBUG")
            var totalFramesRead: Int64 = 0
            var totalFramesWritten: Int64 = 0
            while true {
                var frameCount: UInt32 = bufferSize / destinationFormat.mBytesPerFrame
                 convertedData.mBuffers.mDataByteSize = bufferSize // Reset before read

                error = ExtAudioFileRead(sourceFile!, &frameCount, &convertedData)
                if error != noErr {
                    log("Error during ExtAudioFileRead.", level: "ERROR", osStatusCode: error)
                    return error
                }

                if frameCount == 0 {
                    log("End of source file reached (frameCount is 0). Exiting conversion loop.", level: "INFO")
                    break
                }
                totalFramesRead += Int64(frameCount)

                error = ExtAudioFileWrite(destinationFile!, frameCount, &convertedData)
                if error != noErr {
                     log("Error during ExtAudioFileWrite.", level: "ERROR", osStatusCode: error)
                    return error
                }
                totalFramesWritten += Int64(frameCount)
            }

            log("Conversion loop finished. Total Frames Read: \(totalFramesRead), Total Frames Written: \(totalFramesWritten)", level: "INFO")

             log("simpleConvertToWav completed successfully.")
            return nil // Success

        } catch { // Catch any unexpected Swift-level errors (highly unlikely here)
             log("Unexpected Swift error in simpleConvertToWav: \(error.localizedDescription)", level: "FATAL")
             return kAudioFileUnspecifiedError
        }
    }

} // End of AVFoundationAudio class
