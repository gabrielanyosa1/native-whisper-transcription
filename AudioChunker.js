/**
 * Audio chunking service for WhisperRN transcription.
 * Handles splitting audio into chunks, processing each chunk, and merging results.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { PERFORMANCE_PROFILES } from './PerformanceProfiles';

// --- Import required functions directly from audioUtils ---
// These functions now handle URI/Path logic internally for native calls.
import { getAudioDuration, extractAudioSegment } from './audioUtils';

/**
 * AudioChunker handles splitting audio files into manageable chunks,
 * processing each chunk, and merging the results.
 */
export class AudioChunker {
  /**
   * Create a new AudioChunker instance
   */
  constructor(options) {
    const {
      performanceMode = 'balanced',
      onProgress = () => {},
      onStatusUpdate = () => {},
      whisperContext,
      // Removed: getAudioDuration, extractAudioSegment - we import them now
    } = options || {};

    // Get profile settings for the selected performance mode
    this.profile = PERFORMANCE_PROFILES[performanceMode] || PERFORMANCE_PROFILES.balanced;
    this.chunkSize = this.profile.chunkSizeMs;
    this.overlap = this.profile.overlapMs;

    // Callbacks and context
    this.onProgress = onProgress;
    this.onStatusUpdate = onStatusUpdate;
    this.whisperContext = whisperContext;

    // Internal state
    this.isCancelled = false;
    this.tempChunkFiles = []; // Store URIs of created chunk files for cleanup
    console.log(`[AudioChunker] Initialized with ChunkSize: ${this.chunkSize}ms, Overlap: ${this.overlap}ms`);
  }

  /**
   * Cancel ongoing transcription
   */
  cancel() {
    this.isCancelled = true;
    console.log('[AudioChunker] Cancellation requested.');
    this.cleanupTempFiles(); // Clean up immediately on cancel
  }

  /**
   * Clean up temporary chunk files created during processing
   */
  async cleanupTempFiles() {
    if (this.tempChunkFiles.length === 0) return;
    console.log(`[AudioChunker] Cleaning up ${this.tempChunkFiles.length} temporary chunk files...`);
    const cleanupPromises = this.tempChunkFiles.map(chunkUri => {
        // FileSystem.deleteAsync expects URI
        return FileSystem.deleteAsync(chunkUri, { idempotent: true }).catch(e => {
            console.warn(`[AudioChunker] Failed to delete temp file ${chunkUri}:`, e);
        });
    });
    try {
        await Promise.all(cleanupPromises);
        console.log('[AudioChunker] Temporary files cleanup complete.');
    } catch (error) {
        console.warn('[AudioChunker] Error during batch cleanup:', error);
    } finally {
        this.tempChunkFiles = []; // Clear the list regardless of success
    }
  }

  /**
   * Transcribe a single audio chunk
   * Accepts URI or path for the chunk
   */
  async transcribeSingleChunk(chunkInput, options) {
    if (this.isCancelled) throw new Error('Transcription cancelled');
    if (!this.whisperContext) throw new Error('Whisper context not initialized');

    try {
      const isBundledAsset = typeof chunkInput !== 'string' || !chunkInput.startsWith('file://');
      const logPath = isBundledAsset ? 'Bundled Asset/Sample' : chunkInput;
      // whisper.rn transcribe expects a POSIX path for local files
      const transcribePath = isBundledAsset ? chunkInput : chunkInput.replace(/^file:\/\//, '');

      console.log(`[AudioChunker] Transcribing chunk: ${logPath} (using path: ${transcribePath})`);

      const safeOptions = options || {};

      if (this.whisperContext && typeof this.whisperContext.transcribe === 'function') {
        const { promise } = this.whisperContext.transcribe(transcribePath, safeOptions);
        const result = await promise;

        if (!result || typeof result.result === 'undefined') {
          console.warn('[AudioChunker] Whisper returned unexpected result structure:', result);
          return { result: '', segments: [] }; // Return default structure
        }
        console.log(`[AudioChunker] Chunk transcription raw result: "${result.result}"`);
        return result; // Contains { result: string, segments: [...] }
      } else {
        throw new Error('Invalid Whisper context: transcribe function not available');
      }
    } catch (error) {
      console.error('[AudioChunker] Error transcribing chunk:', error);
      throw error; // Re-throw
    }
  }

  /**
   * Merge transcription results from multiple chunks
   * Basic merging - simply concatenates text results for now.
   */
  mergeTranscriptionResults(results) {
    console.log(`[AudioChunker] Merging results from ${results.length} chunks.`);
    // Sort results by chunk index just in case they arrive out of order
    results.sort((a, b) => a.chunkIndex - b.chunkIndex);

    // Simple concatenation for now
    const mergedText = results.map(r => r.result || '').join(' ').trim();

    // TODO: Implement more sophisticated merging based on timestamps/overlap if needed.
    // const mergedSegments = results.reduce((acc, r) => acc.concat(r.segments || []), []);

    console.log(`[AudioChunker] Merged Text: "${mergedText.substring(0, 100)}..."`);
    return {
      result: mergedText
      // segments: mergedSegments // If implemented
    };
  }

  /**
   * Transcribe audio with chunking
   * Accepts the original audio URI
   */
  async transcribeWithChunking(audioUri, transcriptionOptions = {}, providedDuration = null) {
    console.log(`[AudioChunker] Starting transcribeWithChunking for URI: ${audioUri}`);
    this.isCancelled = false; // Reset cancellation flag
    this.tempChunkFiles = []; // Reset temp file list

    try {
      if (this.isCancelled) throw new Error('Transcription cancelled');

      const isBundledAsset = typeof audioUri !== 'string' || !audioUri.startsWith('file://');

      if (isBundledAsset) {
        this.onStatusUpdate('Processing bundled asset (direct transcription)...');
        console.log('[AudioChunker] Bundled asset detected, using direct transcription.');
        // Use the transcribeSingleChunk method directly for assets
        const result = await this.transcribeSingleChunk(audioUri, transcriptionOptions);
        return { result: result.result || '' };
      }

      // Verify platform support for chunking (implicitly checked by audioUtils availability)
      if (Platform.OS !== 'ios') {
          console.warn('[AudioChunker] Chunking only supported on iOS. Attempting direct transcription.');
          this.onStatusUpdate('Chunking not supported, using direct transcription...');
          const result = await this.transcribeSingleChunk(audioUri, transcriptionOptions);
          return { result: result.result || '' };
      }

      // Get audio duration if not provided
      let audioDuration = providedDuration;
      if (!audioDuration || audioDuration <= 0) {
          this.onStatusUpdate('Analyzing audio file duration...');
          console.log('[AudioChunker] Getting audio duration...');
          try {
              // Use imported function - it expects URI
              audioDuration = await getAudioDuration(audioUri);
              if (!audioDuration || audioDuration <= 0) throw new Error('Invalid duration returned');
              this.onStatusUpdate(`Audio duration: ${(audioDuration / 1000 / 60).toFixed(1)} minutes`);
              console.log(`[AudioChunker] Got duration: ${audioDuration}ms`);
          } catch (durationError) {
              console.error('[AudioChunker] Error getting duration:', durationError);
              this.onStatusUpdate('Could not determine duration, attempting direct transcription...');
              // Pass URI to transcribeSingleChunk
              const result = await this.transcribeSingleChunk(audioUri, transcriptionOptions);
              return { result: result.result || '' };
          }
      }

      // If audio is short, use direct transcription
      const effectiveChunkThreshold = this.chunkSize + this.overlap;
      if (audioDuration <= effectiveChunkThreshold) {
          console.log(`[AudioChunker] Audio duration (${audioDuration}ms) is <= threshold (${effectiveChunkThreshold}ms), using direct transcription.`);
          this.onStatusUpdate('Audio is short, using direct transcription...');
          // Pass URI to transcribeSingleChunk
          const result = await this.transcribeSingleChunk(audioUri, transcriptionOptions);
          return { result: result.result || '' };
      }

      // --- Proceed with Chunking ---
      const chunks = [];
      const step = Math.max(1, this.chunkSize - this.overlap);
      console.log(`[AudioChunker] Chunk Step (ChunkSize - Overlap): ${step}ms`);

      for (let start = 0; start < audioDuration; start += step) {
          const end = Math.min(start + this.chunkSize, audioDuration);
          // Avoid creating tiny slivers at the end
          if (end - start < Math.min(1000, this.overlap)) {
             console.log(`[AudioChunker] Skipping tiny chunk at end: start=${start}, end=${end}`);
             continue;
          }
          chunks.push({ start, end, index: chunks.length, durationMs: end - start });
      }

      console.log(`[AudioChunker] Calculated ${chunks.length} chunks.`);
      if (chunks.length === 0) {
         console.warn("[AudioChunker] No chunks calculated. Trying direct transcription.");
         this.onStatusUpdate('Chunk calculation failed, using direct transcription...');
         // Pass URI to transcribeSingleChunk
         const result = await this.transcribeSingleChunk(audioUri, transcriptionOptions);
         return { result: result.result || '' };
      }

      this.onStatusUpdate(`Processing audio in ${chunks.length} chunks...`);
      let allResults = [];

      for (let i = 0; i < chunks.length; i++) {
          if (this.isCancelled) throw new Error('Transcription cancelled');

          const chunk = chunks[i];
          this.onStatusUpdate(`Extracting & processing chunk ${i + 1}/${chunks.length}...`);
          console.log(`[AudioChunker] Processing Chunk ${i + 1}: Start=${chunk.start}ms, End=${chunk.end}ms`);

          let chunkUri = null;
          try {
              // Extract audio segment - use imported function, expects URI
              console.log(`[AudioChunker] Calling extractAudioSegment for original URI: ${audioUri}`);
              // extractAudioSegment returns the URI of the created chunk
              chunkUri = await extractAudioSegment(audioUri, chunk.start, chunk.end);
              this.tempChunkFiles.push(chunkUri); // Store URI for cleanup
              console.log(`[AudioChunker] Extracted chunk URI: ${chunkUri}`);

              const chunkOptions = { ...transcriptionOptions };
              // Transcribe this chunk (pass URI)
              const result = await this.transcribeSingleChunk(chunkUri, chunkOptions);

              allResults.push({
                  ...result, // Includes { result: string, segments: [...] }
                  chunkIndex: chunk.index,
                  startTime: chunk.start,
                  endTime: chunk.end,
              });

              this.onProgress((i + 1) / chunks.length); // Update progress

          } catch (chunkError) {
              console.error(`[AudioChunker] Error processing chunk ${i + 1}:`, chunkError);
              this.onStatusUpdate(`Skipping problematic chunk ${i + 1}...`);
              // Don't re-throw, just skip this chunk
          } finally {
              // Clean up the individual chunk file immediately after processing (or error)
              // Check if chunkUri (which is a file:// URI) was successfully created
              if (chunkUri) {
                  const uriToDelete = chunkUri; // Use the URI directly
                  FileSystem.deleteAsync(uriToDelete, { idempotent: true })
                      .then(() => console.log(`[AudioChunker] Deleted temp chunk ${uriToDelete}`))
                      .catch(e => console.warn(`[AudioChunker] Failed to delete temp chunk ${uriToDelete}:`, e))
                      .finally(() => {
                          // Remove from list even if deletion failed
                          this.tempChunkFiles = this.tempChunkFiles.filter(uri => uri !== uriToDelete);
                      });
              }
          } // end try/catch/finally for single chunk processing
      } // end for loop over chunks

      if (this.isCancelled) throw new Error('Transcription cancelled');

      this.onStatusUpdate('Merging transcription results...');
      if (allResults.length === 0) {
          throw new Error('Chunking completed, but no valid transcription results were obtained.');
      }

      const mergedResult = this.mergeTranscriptionResults(allResults);

      // Final cleanup (should be empty if finally block worked)
      await this.cleanupTempFiles();

      console.log('[AudioChunker] Chunking transcription complete.');
      return mergedResult;

    } catch (error) {
        console.error('[AudioChunker] Error in transcribeWithChunking:', error);
        // Ensure cleanup happens on any error
        await this.cleanupTempFiles();
        throw error; // Re-throw the error for App.js to handle
    }
  }
} // End Class AudioChunker
