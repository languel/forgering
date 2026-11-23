# Recording a hardware test

Use one entry per physical device and firmware build. A retail model name alone is insufficient to match firmware. Keep the stock firmware identifiers and source so that later tests can be traced to their exact base.

| Field | What to record |
| --- | --- |
| Identity | Retail model, advertised Bluetooth name, reported hardware revision |
| Firmware | Running version before and after the test, image filename, SHA-256, and stock source |
| Connection | Browser and OS, data service, notification format, start and stop commands |
| Capture | Packet count and elapsed time, packets/s, value changes/s, repeated readings, and whether the device was moving |
| Creative mapping | Signal, units, MIDI output and channel, CC or note, and any filtering |
| Result | Hardware observed, simulated, or static analysis. Include the log excerpt needed to reproduce the result |

Record a stock baseline before testing a firmware change. In Ring Studio, compare at least ten seconds of active motion with the same stream settings before and after. Record **Ring gestures** on or off. The packet rate measures BLE delivery. The XYZ change rate also depends on motion, sensor resolution, and repeated readings.

For firmware tests, capture the transfer completion, the disconnect, and a fresh running-version read after reconnect. Treat these as separate observations. Include any reported error status. Keep personal sensor recordings and full device logs out of shared examples unless they are needed and you intend to share them.

For a future device family, start by identifying the available sensor stream and its units. Then document how its continuous signals or discrete events could feed a creative mapping. Keep device-specific commands and firmware separate from the mapping you want students to reuse.
