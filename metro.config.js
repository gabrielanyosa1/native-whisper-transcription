const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// Add .bin files to the asset extensions
defaultConfig.resolver.assetExts.push('bin');

// For iOS include the binary FFmpeg libraries
defaultConfig.resolver.assetExts.push('a');
defaultConfig.resolver.assetExts.push('dylib');

module.exports = defaultConfig;
