#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AVFoundationAudio, NSObject)

RCT_EXTERN_METHOD(getAudioDuration:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(extractAudioSegment:(NSString *)sourcePath
                  outputPath:(NSString *)outputPath
                  startMs:(double)startMs
                  durationMs:(double)durationMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(convertToWavFormat:(NSString *)sourcePath
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isWavFormat:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
