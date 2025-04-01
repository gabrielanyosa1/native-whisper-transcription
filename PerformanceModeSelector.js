/**
 * Performance mode selector UI component.
 * Allows users to select between different transcription performance modes.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PERFORMANCE_PROFILES, getSpeedPercentage, getSpeedRatio } from './PerformanceProfiles';

/**
 * Performance mode selector UI component
 */
const PerformanceModeSelector = ({ currentMode, onChange, disabled = false }) => {
  // Mode options with friendly names
  const modeOptions = [
    { id: 'highest-accuracy', label: 'Highest' },
    { id: 'accurate', label: 'Accurate' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'fast', label: 'Fast' },
    { id: 'fastest', label: 'Fastest' }
  ];

  // Get speed improvement display
  const speedRatio = getSpeedRatio(currentMode);
  const speedDisplay = speedRatio === 1 ? 'Baseline' : `${speedRatio}x faster`;

  return (
    <View style={styles.performanceContainer}>
      <Text style={styles.performanceTitle}>Transcription Performance</Text>
      
      <View style={styles.modeContainer}>
        {modeOptions.map(mode => (
          <TouchableOpacity 
            key={mode.id}
            style={[
              styles.modeOption, 
              currentMode === mode.id && styles.selectedMode,
              disabled && styles.disabledMode
            ]}
            onPress={() => !disabled && onChange(mode.id)}
            disabled={disabled}
          >
            <Text style={[
              styles.modeText, 
              currentMode === mode.id && styles.selectedModeText,
              disabled && styles.disabledText
            ]}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <Text style={styles.modeDescription}>
        {PERFORMANCE_PROFILES[currentMode]?.description || ''}
      </Text>
      
      {/* Speed/accuracy indicator */}
      <View style={styles.estimatedTimeContainer}>
        <View style={styles.timeScale}>
          <View 
            style={[
              styles.timeIndicator, 
              {left: `${getSpeedPercentage(currentMode)}%`}
            ]} 
          />
          <Text style={styles.fasterLabel}>Faster</Text>
          <Text style={styles.accurateLabel}>More Accurate</Text>
        </View>
        <Text style={styles.speedRatio}>{speedDisplay}</Text>
      </View>
    </View>
  );
};

// Styles
const styles = StyleSheet.create({
  performanceContainer: {
    marginVertical: 10,
    marginHorizontal: 15,
    padding: 12,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
  },
  performanceTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  modeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modeOption: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: '#e1e1e6',
  },
  selectedMode: {
    backgroundColor: '#007aff',
  },
  disabledMode: {
    backgroundColor: '#e1e1e6',
    opacity: 0.5,
  },
  modeText: {
    fontSize: 12,
    color: '#4a4a4a',
  },
  selectedModeText: {
    color: 'white',
    fontWeight: '600',
  },
  disabledText: {
    color: '#999',
  },
  modeDescription: {
    fontSize: 12,
    color: '#6e6e73',
    textAlign: 'center',
    marginVertical: 6,
    paddingHorizontal: 8,
  },
  estimatedTimeContainer: {
    marginTop: 2,
  },
  timeScale: {
    height: 3,
    backgroundColor: '#d1d1d6',
    marginVertical: 8,
    borderRadius: 2,
    position: 'relative',
  },
  timeIndicator: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007aff',
    top: -3.5,
    marginLeft: -5,
  },
  fasterLabel: {
    position: 'absolute',
    right: 0,
    top: 6,
    fontSize: 10,
    color: '#8e8e93',
  },
  accurateLabel: {
    position: 'absolute',
    left: 0,
    top: 6,
    fontSize: 10,
    color: '#8e8e93',
  },
  speedRatio: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 11,
    color: '#007aff',
    fontWeight: '500',
  }
});

export default PerformanceModeSelector;
