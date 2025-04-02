# Notes:
* Succesful build, fast transcription, however:
    * Model is loaded MULTIPLE times (on a per transcription basis), which induces extreme memory overhead and pressure. OOM is achieved at third step transcription –> Lead to mem crash and app exit.
    * Debug logic and introduce better UI.
        * Implement file access for on device transcriptions, live streaming using base and small models, etc.
        * Translation services and diarization for small models. 