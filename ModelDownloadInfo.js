import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { PERFORMANCE_PROFILES } from './PerformanceProfiles';

// Model sizes for showing info to users
const MODEL_SIZES = {
  'ggml-large-v3-q5_0.bin': '1.07 GB',
  'ggml-large-v3-turbo-q5_0.bin': '574 MB'
};

/**
 * Component to show model download information and status
 */
const ModelDownloadInfo = ({ 
  currentMode, 
  modelManager, 
  isModelLoaded,
  onDeleteModels 
}) => {
  const profile = PERFORMANCE_PROFILES[currentMode];
  const modelFile = profile?.modelFile || '';
  const modelSize = MODEL_SIZES[modelFile] || 'Unknown';
  
  // Show a delete button if models are downloaded
  const handleDelete = () => {
    Alert.alert(
      'Delete Downloaded Models',
      'This will delete all downloaded model files to free up space. You will need to download them again when you next use the app.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: onDeleteModels
        }
      ]
    );
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.infoContainer}>
        <Text style={styles.modelTitle}>Current model: {modelFile}</Text>
        <Text style={styles.modelInfo}>Size: {modelSize} {isModelLoaded ? '(Loaded)' : '(Not loaded)'}</Text>
      </View>
      
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={handleDelete}
      >
        <Text style={styles.deleteButtonText}>Delete Models</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f7',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 15,
    marginBottom: 10,
  },
  infoContainer: {
    flex: 1,
  },
  modelTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  modelInfo: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  }
});

export default ModelDownloadInfo;
