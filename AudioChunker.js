/**
 * Audio chunking service for WhisperRN transcription.
 * Handles splitting audio into chunks, processing each chunk, and merging results.
 */

import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import { PERFORMANCE_PROFILES } from './PerformanceProfiles';

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
      whisperContext
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
    this.tempFiles = [];
  }

  /**
   * Cancel ongoing transcription
   */
  cancel() {
    this.isCancelled = true;
    this.cleanupTempFiles();
  }

  /**
   * Clean up temporary files created during chunking
   */
  async cleanupTempFiles() {
    try {
      for (const filePath of this.tempFiles) {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
      this.tempFiles = [];
    } catch (error) {
      console.warn('Error cleaning up temp files:', error);
    }
  }

  /**
   * Get audio duration in milliseconds
   */
  async getAudioDuration(audioPath) {
    try {
      // For files from assets (like sample.wav), we need a different approach
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

  /**
   * Extract a segment of audio from the file
   */
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

  /**
   * Transcribe a single audio chunk
   */
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

  /**
   * Merge transcription results from multiple chunks
   */
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

  /**
   * Transcribe audio with chunking
   */
  async transcribeWithChunking(audioPath, transcriptionOptions = {}) {
    try {
      if (this.isCancelled) {
        throw new Error('Transcription cancelled');
      }
      
      // For bundled assets, use direct transcription
      if (typeof audioPath !== 'string') {
        this.onStatusUpdate('Processing bundled asset (direct transcription)...');
        try {
          // Direct transcription for bundled assets
          const result = await this.transcribeSingleChunk(audioPath, transcriptionOptions);
          return { result: result.result || '' };
        } catch (error) {
          console.error('Error transcribing bundled asset:', error);
          throw new Error(`Failed to transcribe bundled asset: ${error.message}`);
        }
      }
      
      // Get audio duration
      this.onStatusUpdate('Analyzing audio file...');
      let audioDuration;
      try {
        audioDuration = await this.getAudioDuration(audioPath);
        this.onStatusUpdate(`Audio duration: ${(audioDuration / 1000 / 60).toFixed(1)} minutes`);
      } catch (durationError) {
        console.error('Error getting duration:', durationError);
        // Just use direct transcription if we can't determine duration
        this.onStatusUpdate('Could not determine audio duration, using direct transcription...');
        const result = await this.transcribeSingleChunk(audioPath, transcriptionOptions);
        return { result: result.result || '' };
      }
      
      // If audio is short, use direct transcription
      if (audioDuration <= this.chunkSize) {
        this.onStatusUpdate('Audio is short, using direct transcription...');
        const result = await this.transcribeSingleChunk(audioPath, transcriptionOptions);
        return { result: result.result || '' };
      }
      
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
      
      this.onStatusUpdate(`Processing audio in ${chunks.length} chunks...`);
      let allResults = [];
      
      // Process each chunk sequentially
      for (let i = 0; i < chunks.length; i++) {
        if (this.isCancelled) {
          throw new Error('Transcription cancelled');
        }
        
        const chunk = chunks[i];
        this.onStatusUpdate(`Processing chunk ${i+1}/${chunks.length}...`);
        
        try {
          // Extract audio segment for this chunk
          const chunkPath = await this.extractAudioSegment(audioPath, chunk.start, chunk.end);
          
          // Set chunk-specific options
          const chunkOptions = {
            ...transcriptionOptions,
            offset_ms: chunk.start,  // Tell Whisper where this chunk starts
          };
          
          // Transcribe this chunk
          const result = await this.transcribeSingleChunk(chunkPath, chunkOptions);
          
          // Store result with metadata
          allResults.push({
            ...result,
            chunkIndex: chunk.index,
            startTime: chunk.start,
            endTime: chunk.end,
            result: result.result || '' // Ensure result has a string value
          });
          
          // Update progress
          this.onProgress((i + 1) / chunks.length);
          
          // If this is a string path (not a bundled asset), clean up
          if (typeof chunkPath === 'string' && chunkPath !== audioPath) {
            // Delete chunk file to save space
            try {
              await FileSystem.deleteAsync(chunkPath, { idempotent: true });
              // Remove from tempFiles list
              this.tempFiles = this.tempFiles.filter(file => file !== chunkPath);
            } catch (cleanupError) {
              console.warn('Could not delete chunk file:', cleanupError);
            }
          }
        } catch (chunkError) {
          console.error(`Error processing chunk ${i+1}:`, chunkError);
          // Continue with next chunk instead of failing completely
          this.onStatusUpdate(`Skipping problematic chunk ${i+1} and continuing...`);
        }
      }
      
      // Merge results
      this.onStatusUpdate('Merging transcription results...');
      
      // If no results were obtained, throw error
      if (allResults.length === 0) {
        throw new Error('No valid transcription results were obtained');
      }
      
      const mergedResult = this.mergeTranscriptionResults(allResults);
      
      // Clean up temporary files
      await this.cleanupTempFiles();
      
      return mergedResult;
    } catch (error) {
      console.error('Error in chunked transcription:', error);
      // Ensure we clean up even if there's an error
      await this.cleanupTempFiles();
      throw error;
    }
  }
}
