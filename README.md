# ForgeRing

Ring Studio is a browser instrument for turning live smart-ring motion into creative controls. Use it to see how movement becomes a signal, map that signal to MIDI, or teach the app a gesture. ForgeRing is the ring-focused part of a broader exploration of real-time sensing for creative expression.

## For students

Open [Ring Studio](https://languel.github.io/forgering/) in desktop Chrome with Bluetooth enabled. You can try **Gesture Lab → Demo** and the internal synth before connecting a ring. For hardware, click **Connect**, select your R02 or R10, then start the stream.

The webcam is optional for pose calibration and stops automatically when calibration completes. Training examples are saved in the browser for this site. Examples recorded on localhost stay with the localhost origin.

## Start Ring Studio locally

Use desktop Chrome with Bluetooth enabled. From the repository root, run:

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

Open [Ring Studio on localhost](http://localhost:8001/). The app serves static files and connects directly to the ring over Bluetooth. Gesture examples and interface preferences are stored in the browser.

1. Click **Connect**, select the ring, and start **Stream**. Compare incoming packets per second with how often XYZ values change.
2. In **Mapping**, choose a MIDI destination and channel, then assign motion or gesture events. To teach a gesture, record at least two examples with a similar starting orientation and enable **Recognition**.
3. Use **Log & Commands** to view or copy the connection trace. Open **?** for controls and firmware help.

Start with the ring as shipped. A firmware update is optional for the classroom exercise.

## Gesture Lab

Connect the ring and start streaming, then open **Gesture Lab**. **Demo** plays a labeled simulation with repeating squeezes and alternating signed flicks.

Wear the R02 snugly and comfortably at the base of your finger, with the red and green optical sensors on the **palm side** of your finger. The Gesture Lab model uses the index finger as its reference. [COLMI R02 user manual](https://www.colmi.info/cdn/shop/files/COLMi_R02_Smart_Ring_User_Manual.pdf?v=1706753755) · [COLMI wearing guidance](https://www.colmi.info/pages/colmi-ring-faq#the-correct-direction-for-wearing-a-ring)

For pose calibration, start the ring stream and click **Start camera**. With an upright webcam, select **Guided calibration**. Match the gold target with your mint tracked hand. Hold your hand up like a greeting, turn your palm toward yourself with your thumb up and fingers pointing sideways, then bring your hand upright and lean toward screen right. MediaPipe runs in the browser after downloading its runtime and model. The lab checks the three poses for consistency before applying the fit. The camera stops automatically when calibration applies an alignment. Adjust **Marker clock** to match where the ring sits around your finger.

For manual alignment, click **Recenter** while holding the ring in a comfortable neutral pose. Tilt it about 30° toward the right side of the preview, hold it there, and click **Mark right tilt**. Adjust the rest angles, direction flips, or motion scale as needed. The accelerometer measures tilt relative to gravity. Tracking rotation around the gravity axis takes a continuous visual reference.

- **Squeeze**. Rest your hand and select **Calibrate rest**. Squeeze once and compare the two raw traces and meters with their activation marks. Adjust **Blood Δ** and **HRS Δ** for your ring and fit. Both signals have to clear their thresholds to open the gate. It closes when either drops below half its threshold or times out. The gate draws ink on the 3D view and can hold a synth note.
- **Ink**. Open the Ink tab and squeeze at the start of a short motion. The front, top, side, and 3D views show the same stroke. Drag the 3D view to orbit it, or choose **Expand 3D** for a single viewport. Drag to pan the fixed views, and Shift-drag or enable **Pan 3D** to pan the 3D view. Scroll to zoom under the pointer or use the + and − buttons for the selected view. **Reset views** restores the original framing. Each stroke starts at center and the cursor returns there without drawing on release. **Integrated position** subtracts estimated gravity, then integrates acceleration to velocity and displacement. The distance is estimated from the start of the squeeze. **Follow tilt** slowly updates gravity during the stroke. Try **Fixed during stroke** for a stroke with a steady hand angle, or **Damped motion** for a drift-limited shape. Changes in tilt, sensor bias, and missed samples can distort the estimate.
- **Flick**. A sharp motion reports the dominant signed ring axis. Try one direction at a time and adjust the threshold in g. The directions follow the ring's axes as you rotate your hand.
- **Test synth**. Select **Test note** to hear the oscillator, then choose the gate, pitch, and filter sources. The starting patch uses squeeze, roll, and HRS respectively. Audio starts on a click and runs locally through Web Audio.
- **Capture**. Record a named take and export timestamped samples, events, damped trajectories in arbitrary units, and integrated trajectories in estimated metres. Both trajectories start at zero with each squeeze. A take runs for up to one minute and stays in the page until you export it or replace it. **Train examples** opens the existing accelerometer gesture learner in Mapping.

### Train a gesture catalog

In **Mapping → Gesture map**, add a label and record three to five examples from a similar starting orientation. **Hold to mark** uses Space or the hold button to mark the start and end. **Squeeze** uses the optical gate after **Calibrate rest**. **Automatic motion** starts and ends on accelerometer activity.

Enable **Recognition** to match a new gesture against the saved examples. Matching uses dynamic time warping, which allows some change in tempo, and rejects weak or ambiguous matches. **Evaluate catalog** tests each saved example against the others and shows which labels get confused. Existing examples and MIDI assignments are kept in browser storage. Expand **View recorded examples** to inspect their XYZ traces. The map shows the latest detection and lets you disable built-in or learned gestures independently. Each row can play its own internal synth note, send MIDI, or do both. Enable synth audio to hear it and use **Preview mapping** to audition it without a gesture. In **Gesture Lab** or **Ink**, the gesture monitor compares the latest attempt with saved examples as signed XYZ fingerprints. A nearer template has a lower distance. The monitor keeps the last accepted match visible while you make new attempts. The enrollment and evaluation flow was inspired by [SubVox](https://github.com/joeblau/subvox).

In an R02 session, the built-in **Camera Trigger** (`0x04`) fired after a pause and a light wrist shake, with a noticeable delay. The lab records it as a discrete event and offers it as an optional synth trigger. Use the live motion and optical streams to explore more immediate AV controls.

## Firmware and hardware

| Ring tested | Hardware revision | Working motion build | Hardware observation |
| --- | --- | --- | --- |
| COLMI R02 | `RY02_V3.0` | `RY02_3.00.38_250403` experimental 40 ms | 40 ms felt responsive, with about 1% repeated values reported |
| COLMI R10 | `RY03CR_V1.0` | `RY03CR_1.00.06_T040H1` | Version verified after flashing and faster motion observed. Exact packet rate still to measure |

1. Open **Firmware** and choose **Connect ring** to read the hardware revision and running version.
2. Choose a stock or 40 ms preset. Download its linked stock base and choose that file. The browser verifies its SHA-256, builds the selected image locally, and checks the result against the tested hash. For an existing complete image, expand **Use a local firmware file**.
3. Choose **Flash firmware** and confirm. The image must match the connected hardware. Reconnect after the ring restarts to check the running version.

| Build | Stock base download | Hardware |
| --- | --- | --- |
| R02 40 ms | [RY02_3.00.38_250403.bin](https://api2.qcwxkjvip.com/download/ota/RY02_V3.0/RY02_3.00.38_250403.bin) | `RY02_V3.0` |
| R10 40 ms, T040H1 | [RY03CR_1.00.06_241212.bin](https://api2.qcwxkjvip.com/download/ota/RY03CR_V1.0/RY03CR_1.00.06_241212.bin) | `RY03CR_V1.0` |

Complete firmware files contain vendor code, and redistribution permission has not been established. The public repository provides patch instructions, verified hashes, and original download links.

The 40 ms builds target 25 reports/s. A retail model name can cover multiple hardware revisions. In **Firmware**, read the connected ring’s exact revision and stage a matching image before choosing **Flash firmware**. A wrong or failed update can leave the ring unusable. After reconnecting, read the running version to check activation.

[Firmware findings and provenance](docs/ring-firmware.md) cover the stock bases, R02 timing experiments, the R10 transfer that completed without activating, and the checksum fix. [Hardware notes](docs/hardware.md) give a repeatable way to document the next device.

## Repository layout

- `index.html` contains Ring Studio’s UI, Bluetooth monitor, and MIDI mapping.
- `ring-gestures.js` handles example capture and live recognition.
- `ring-firmware.js` handles image staging, Bluetooth OTA, and version verification.
- `firmware/` contains the 40 ms patch descriptions and reference SHA-256 checksums.
- `tools/build-r10-40ms.py` reproduces the tested R10 image from the exact stock base.

The OTA transport draws on [Aaron Christophel’s COLMI ring research and RF03 loader](https://github.com/atc1441/ATC_RF03_Ring). Firmware provenance is listed in the findings. The Ring Studio source is distributed under GPL-3.0, following the upstream loader license. The third-party firmware downloads have their own terms.
