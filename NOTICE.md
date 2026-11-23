# Source and firmware provenance

Ring Studio's Bluetooth protocol and OTA transport build on Aaron Christophel's COLMI ring research and RF03 loader.

- Research and GPL-3.0 license — https://github.com/atc1441/ATC_RF03_Ring
- Reference browser loader — https://atc1441.github.io/ATC_RF03_Writer.html
- Gesture enrollment workflow inspiration — https://github.com/joeblau/subvox
- Optional hand calibration loads MediaPipe Tasks Vision 0.10.32 and Google's Hand Landmarker model at runtime — https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

The source in this repository is offered under GPL-3.0. Complete stock and patched firmware images contain vendor code. Permission to redistribute those images has not been established, so obtain the exact stock bases from their linked sources and apply the provided hash-verified patches locally. See docs/ring-firmware.md for hardware testing and provenance.
