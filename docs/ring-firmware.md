# COLMI ring firmware inventory

| Retail model | Bluetooth name | Hardware revision | Original firmware on the ring | Stock base used for custom builds |
| --- | --- | --- | --- | --- |
| COLMI R02 | `R02_…` | `RY02_V3.0` | [`RY02_3.00.33_250117`](https://github.com/atc1441/ATC_RF03_Ring/blob/main/OTA_firmwares/RY02_3.00.33_250117.bin) | [`RY02_3.00.38_250403`](https://api2.qcwxkjvip.com/download/ota/RY02_V3.0/RY02_3.00.38_250403.bin) |
| COLMI R10 | `COLMI R10_…` | `RY03CR_V1.0` | [`RY03CR_1.00.06_241212`](https://api2.qcwxkjvip.com/download/ota/RY03CR_V1.0/RY03CR_1.00.06_241212.bin) | Same as original |

## R02 motion timing

The [40 ms experimental build](../README.md#firmware-and-hardware) targets 25 motion reports per second. In hands-on testing, 40 ms felt like the sweet spot and about 1% of reports were repeats. The report interval alone cannot establish the sensor sample rate.

## R10 motion timing

The first 40 ms experimental build targeted 25 motion reports per second. The stock image came from the [vendor OTA server](https://api2.qcwxkjvip.com/download/ota/RY03CR_V1.0/RY03CR_1.00.06_241212.bin). Its hardware and firmware strings match the device readout, and its length fields and payload checksum validate.

The patch replaces the equivalent of `125 << 3` with `40` at file offset `0x1e0e`, using the same instruction changes as the R02 40 ms build. It updates the OTA payload byte sum at `0x0c` and preserves the R10 image flags. After uploading this image, the R10 was measured at 1.0 packets/s and 1.0 XYZ changes/s. The raw-only test with Ring gestures disabled gave the same rates. The stock and experimental images report the same firmware version, so a successful upload does not identify the image running after reboot. Static disassembly confirms that the patched timer calls the routine that emits `A1 03` acceleration packets. Ring Studio can compare the incoming packet rate and the XYZ change rate with the ring’s built-in gesture mode enabled or disabled.

| R10 image | SHA-256 |
| --- | --- |
| Stock | `1633f8e8581af209bae949c4b4b1c19b3511de3606e8785e765629054dce2c62` |
| Experimental 40 ms | `09abf4e2cff308ac4ed147daa9ce095b5f5e2db5a289c8fde30350bb93491a0b` |
| Experimental 40 ms (tagged) | `e5437bb0aab67ac23e408e7ec966f029bd809c01d1466f63d8af6a12516d7fa6` |

The second diagnostic image kept the same 40 ms timer patch. Its OTA header and both embedded version strings used `T040MS` in place of `241212`. Seeing `RY03CR_1.00.06_T040MS` in Device Information after reconnecting would confirm that the tagged application booted.

The first tagged hardware upload reached 100%, but after reconnecting the R10 reported the original `RY03CR_1.00.06_241212`. This confirms a version mismatch after transfer. Ring Studio now logs the final OTA responses, the command 5 write, and whether the Bluetooth link dropped or Disconnect was clicked.

A subsequent instrumented upload received a command 4 response with payload `00`. The command 5 write returned and the Bluetooth link dropped 0.7 seconds after the send, without a manual disconnect. The ring again reported stock firmware on reconnect. The log establishes that the transfer reached the final OTA step and the link dropped. It does not establish why the tagged firmware failed to appear after reconnect.

## R10 application image validation

The stock and two earlier experimental images passed the outer OTA byte-sum check and declare the same inner application length of 109,744 bytes. The inner 1 KiB application header is byte-for-byte identical in all three files, while the application payloads differ. The [Realtek RTL8762E SDK User Guide](https://www.realmcu.com/img/ipd/en_637839320584437719.pdf), section 9.2.2, documents separate application image integrity metadata. That distinction led to the application digest investigation below.

A search for a second vendor release for `RY03CR_V1.0` found only the known stock version. The vendor still serves the stock binary with the same SHA-256. The model directory does not allow listing. A second version offered by QRing for this ring would provide a control. Re-uploading the current stock build would leave the same version string even if activation succeeded.

QRing reported that the ring already has the latest firmware. Offline checks did not reproduce the stock application's inner integrity metadata with a plain SHA-256 of the payload or the common CRC-16 variants tested. The outer OTA byte sum remains independently verified. The post-tagged-upload log contains 21 acceleration notifications over 21 seconds (about 1 packet/s), with 19 distinct XYZ values. Built-in Ring gestures was enabled in this run. The earlier untagged upload measured 1 packet/s in both modes.

### Cross-check against the R02 builds

The R02 and R10 stock files have the same application-header control flags and a zero CRC-16 field. Each has a populated 32-byte digest field. A plain payload SHA-256 and the tested header-plus-payload variants did not reproduce that field on either stock file. Both 40 ms builds retain the stock digest even though their payloads changed. Since R02 experimental builds ran on hardware, a stale digest alone does not establish why the R10 returns to stock.

The R02 experimental file differs from its stock base in one additional inner-header location. Under the Realtek SDK layout, it is the OTA image-readiness flag. The R10 experimental files retain the stock value. This is a concrete difference to investigate in the vendor OTA preparation and commit flow. Whether it accounts for the R10 behavior remains unverified. No image or hardware was modified during this comparison.

### OTA completion path

The [Realtek OTA manual for the related RTL8762C](https://www.realmcu.com/img/ipd/en_638336748855965221.pdf) describes readiness as a device-side state. The updater writes the temporary image as not ready and marks it ready after validation. That reference explains why changing readiness in the input file is not an appropriate test of whether the R10's validation succeeds. The R10 uses a vendor-specific OTA transport on the RTL8762E family.

Disassembly of stock `RY03CR_1.00.06_241212` shows the first data-block handler checking the COLMI wrapper and writing the inner image to staging flash. At file offset `0x6d60`, command 4 checks the transfer state and staged length, and returns status `00` on that path. The captured response `bc040100bf4000` confirms those checks passed. At `0x6d9c`, command 5 enters finalization and calls an image routine through ROM before continuing toward restart. That handler does not forward the routine's result in an OTA response. Thus the captured link drop does not tell us whether the image-management routine accepted the staged image. Ring Studio now stops on nonzero one-byte R10 status responses to commands 3 and 4. The recorded attempt returned zero, so this change does not explain its failure to activate.

### R10 candidate with verified application checksum

A public [RTL8762E reference build](https://github.com/atc1441/ATC_RTL_BLE_OEPL/tree/main/ATC_RTL_BLE_OEPL_8762ESL) includes the Realtek packaging tool and ROM symbols. The ROM map identifies the finalization call as `check_image_chksum` and the success-only call as `dfu_set_ready`. Other calls, including the OTA bank lookup and memory copy, match the same map. The handler continues toward restart without returning the checksum result to the host.

Analysis of the vendor packaging tool reproduced the embedded SHA-256 on the reference build, both stock R02 images, and the stock R10. With offsets relative to the start of the Realtek application image, the digest covers `[0x0c, 0x174)`, `[0x194, 0x2f0)`, and `[0x3f0, end)` in order. Both earlier experimental R10 images fail that check.

The [checksum-corrected R10 build](../README.md#firmware-and-hardware) uses the same 40 ms timer edit, a distinct version tag `RY03CR_1.00.06_T040H1`, a recomputed inner application digest, and a recomputed outer byte sum. It preserves the stock readiness flag and other boot fields. Its digest and wrapper validate offline. Ring Studio offers this build as **R10 · 40 ms (checksum fixed)**. On November 15, 2026, the tested R10 successfully booted the build and reported `RY03CR_1.00.06_T040H1` after reconnect. The user observed a substantially faster live stream. The exact packet rate has yet to be measured against the 25 packets/s target.

- Full image SHA-256 `88546e22ad72aeefb87028ab9b8fba99e60e32e8a7a1ea7f507179d45d274c39`
- Embedded application SHA-256 `49e61123e80334077bd860afc21a1f51c10fbc9e8d3afa2fe918a3b37f18c52b`

## Firmware provenance

- R02 original `RY02_3.00.33_250117` matches [ATC1441’s stock archive](https://github.com/atc1441/ATC_RF03_Ring/blob/main/OTA_firmwares/RY02_3.00.33_250117.bin).
- R02 test base `RY02_3.00.38_250403` matches the [vendor OTA image](https://api2.qcwxkjvip.com/download/ota/RY02_V3.0/RY02_3.00.38_250403.bin).
- R10 stock `RY03CR_1.00.06_241212` matches the [vendor OTA image](https://api2.qcwxkjvip.com/download/ota/RY03CR_V1.0/RY03CR_1.00.06_241212.bin).
- The earlier R10 attempts are recorded by checksum above and omitted from the firmware presets. The reference image hashes are listed in [SHA256SUMS](../firmware/SHA256SUMS).

To reproduce the working R10 image from the repository root:

```sh
python3 tools/build-r10-40ms.py --stock /path/to/RY03CR_1.00.06_241212.bin /tmp/r10-40ms.bin
```
