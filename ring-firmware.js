"use strict";

// RF03 OTA transport shared with the monitor's existing GATT connection.
const FirmwareLoader = {
    image: null,
    hardware: null,
    active: false,
    waiting: null,
    selection: 0,
    verification: null,
    reportedVersion: null,

    init() {
        const preset = document.getElementById('firmware-preset');
        const local = document.getElementById('firmware-file');
        const base = document.getElementById('firmware-base');
        const baseFile = document.getElementById('firmware-base-file');
        preset.addEventListener('change', async () => {
            local.value = baseFile.value = '';
            this.clear();
            base.hidden = true;
            const option = preset.selectedOptions[0];
            if (!option?.value) return;
            const selection = this.selection;
            try {
                const build = await this.presetBuild(option);
                if (selection !== this.selection) return;
                const link = document.getElementById('firmware-stock-link');
                link.href = build.source;
                link.textContent = `Download ${build.stock}`;
                base.hidden = false;
            } catch (error) {
                if (selection === this.selection) this.status(error.message);
            }
        });
        baseFile.addEventListener('change', () => {
            const file = baseFile.files[0];
            const option = preset.selectedOptions[0];
            if (!file || !option?.value) return;
            void this.stage(() => this.readPreset(option,file));
        });
        local.addEventListener('change', () => {
            const file = local.files[0];
            if (!file) return;
            local.value = '';
            preset.value = '';
            base.hidden = true;
            void this.stage(async () => ({name: file.name, buffer: await file.arrayBuffer()}));
        });
        document.getElementById('firmware-connect').addEventListener('click', () => void BLE.connect());
        document.getElementById('firmware-flash').addEventListener('click', () => void this.flash());
    },

    async presetBuild(option) {
        const catalog = await fetch('firmware/40ms-patches.json');
        if (!catalog.ok) throw new Error('Firmware catalog is unavailable. Choose the image again to retry.');
        const build = (await catalog.json()).find(item => item.id === option.dataset.build);
        if (!build) throw new Error('Unknown firmware preset');
        return build;
    },

    async readPreset(option,file) {
        const build = await this.presetBuild(option);
        const buffer = await file.arrayBuffer();
        const hash = async input => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input)),
            byte => byte.toString(16).padStart(2,'0')).join('');
        if (await hash(buffer) !== build.inputHash) throw new Error('Stock SHA-256 differs from the linked base for this preset');
        const bytes = new Uint8Array(buffer);
        const stock = option.hasAttribute('data-stock');
        if (!stock) {
            for (const change of build.changes) bytes.set(change.bytes,change.offset);
        }
        if (await hash(bytes) !== (stock ? build.inputHash : build.outputHash)) throw new Error('Image SHA-256 differs from the verified preset');
        return {name:stock ? build.stock : build.name,buffer:bytes.buffer,hardware:build.hardware};
    },

    clear() {
        this.selection++;
        this.image = null;
        this.verification = null;
        document.getElementById('firmware-image').textContent = '';
        this.setProgress(0);
        this.status('');
        this.render();
    },

    async stage(read) {
        this.clear();
        const selection = this.selection;
        const output = document.getElementById('firmware-image');
        output.textContent = 'Verifying image…';
        try {
            const {name, buffer, hardware} = await read();
            if (selection !== this.selection) return;
            const image = this.inspect(buffer);
            if (hardware && image.hardware !== hardware) throw new Error('Image hardware differs from the preset');
            this.image = {name, ...image};
            output.textContent = `Image verified · ${image.hardware} · ${image.version}`;
            this.render();
        } catch (error) {
            if (selection !== this.selection) return;
            output.textContent = `Image rejected · ${error.message}`;
            return false;
        }
    },

    inspect(buffer) {
        if (buffer.byteLength <= 0x50 || buffer.byteLength > 12_288_000) throw new Error('Invalid image length');
        const header = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        if (header.getUint32(0, true) !== 0x81bdc3e5) throw new Error('Unsupported OTA header');
        if ([4, 8].some(offset => header.getUint32(offset, true) !== bytes.length - 0x50)) {
            throw new Error('Payload length mismatch');
        }
        const sum = bytes.subarray(0x50).reduce((total, byte) => total + byte, 0) >>> 0;
        if (header.getUint32(12, true) !== sum) throw new Error('Payload checksum mismatch');
        const decoder = new TextDecoder();
        const readString = (start, end) => decoder.decode(bytes.subarray(start, end)).split('\0', 1)[0].trim();
        const version = readString(0x10, 0x30);
        const hardware = readString(0x30, 0x50);
        if (!version || !hardware) throw new Error('Missing version or hardware revision');
        return {bytes, version, hardware};
    },

    setHardware(hardware) {
        this.hardware = hardware;
        if (!hardware) this.reportedVersion = null;
        this.render();
    },

    render() {
        const button = document.getElementById('firmware-flash');
        const connected = RingController.isConnected;
        const matching = this.image && this.hardware === this.image.hardware;
        button.disabled = this.active || !matching || !connected;
        const connect = document.getElementById('firmware-connect');
        connect.hidden = connected;
        connect.disabled = this.active || RingController.isConnecting;
        connect.textContent = RingController.isConnecting ? 'Connecting…' : 'Connect ring';
        const read = document.getElementById('read-device-info');
        read.hidden = !connected;
        read.disabled = this.active;
        const comparison = document.getElementById('firmware-version-check');
        comparison.textContent = matching && this.reportedVersion && this.reportedVersion !== this.image.version
            ? `Running ${this.reportedVersion} · selected ${this.image.version}` : '';
        const gate = document.getElementById('firmware-mismatch');
        if (this.active || !this.image || matching) gate.textContent = '';
        else if (!connected) gate.textContent = 'Connect the ring to check compatibility.';
        else if (!this.hardware) gate.textContent = 'Read the ring’s hardware revision before flashing.';
        else gate.textContent = `Hardware mismatch · image ${this.image.hardware} · ring ${this.hardware}`;
    },

    setProgress(percent) {
        document.getElementById('firmware-progress').value = percent;
        document.getElementById('firmware-percent').textContent = `${Math.floor(percent)}%`;
    },

    status(message) {
        document.getElementById('firmware-status').textContent = message;
    },

    handleNotify(bytes) {
        if ((!this.active && !this.verification) || bytes[0] !== 0xbc) return false;
        const type = bytes[1];
        const detail = Utils.bytesToHex(bytes);
        if (bytes.length < 6) {
            UI.addLog(`OTA response too short: ${detail}`);
            return true;
        }
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (header.getUint16(2, true) !== bytes.length - 6 ||
            header.getUint16(4, true) !== Utils.crc16(bytes.subarray(6))) {
            UI.addLog(`OTA response failed length or CRC check: ${detail}`);
            return true;
        }
        if (type !== 3 || type !== this.waiting?.type || bytes.length > 6) {
            UI.addLog(`OTA RX command ${type}: ${detail}`, `ota-rx-${type}`);
        }
        if (type === this.waiting?.type) {
            // RY03CR uses a one-byte result for block and length acknowledgments.
            if (this.hardware === 'RY03CR_V1.0' && (type === 3 || type === 4) && bytes.length === 7 && bytes[6] !== 0) {
                this.waiting.reject(new Error(`Ring rejected OTA command ${type} (status ${bytes[6]})`));
            } else {
                this.waiting.resolve();
            }
        }
        return true;
    },

    readVersion(version) {
        this.reportedVersion = version;
        this.render();
        const check = this.verification;
        if (!check?.reconnected || check.device !== RingController.device?.id || !version) return;
        this.verification = null;
        const message = version !== check.expected
            ? `Version mismatch after reconnect · expected ${check.expected}, ring reports ${version}`
            : version === check.previous
                ? `Ring reports ${version} · same version as before upload`
                : `Running version verified · ${version}`;
        this.status(message);
        UI.addLog(message);
    },

    disconnected(origin = 'Bluetooth link dropped') {
        const check = this.verification;
        if (check && !check.reconnected) {
            check.reconnected = true;
            const elapsed = ((performance.now() - check.finalizingAt) / 1000).toFixed(1);
            UI.addLog(`OTA disconnect: ${origin}, ${elapsed}s after sending command 5`);
        }
        this.waiting?.reject(new Error('Ring disconnected'));
    },

    async send(write, type, payload, acknowledge = true) {
        const packet = Utils.addHeader(type, payload);
        let timeout;
        const acknowledgment = acknowledge ? new Promise((resolve, reject) => {
            this.waiting = {type, resolve, reject};
            timeout = setTimeout(() => reject(new Error(`No acknowledgment for OTA command ${type}`)), 12000);
        }) : Promise.resolve();
        const transmit = async () => {
            for (let start = 0; start < packet.length; start += 200) {
                await write.writeValue(packet.subarray(start, start + 200));
                if (type === 3 && start + 200 < packet.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        };
        const transmission = transmit();
        try {
            await Promise.all([transmission, acknowledgment]);
        } finally {
            clearTimeout(timeout);
            this.waiting = null;
            await transmission.catch(() => {});
        }
    },

    async flash() {
        const {image} = this;
        const write = RingController.writeCharacteristic;
        if (this.active || !write || !RingController.isConnected || !image || this.hardware !== image.hardware) return;
        if (!confirm(`Flash ${image.name} to ${RingController.device.name || image.hardware}? An incompatible build can leave the ring unusable.\n\nKeep the ring charged and nearby until it restarts.`)) return;

        const verification = {
            device: RingController.device.id, expected: image.version, previous: this.reportedVersion, reconnected: false
        };
        this.verification = null;
        this.active = true;
        const locked = document.querySelectorAll('.toolbar, .studio-tabs, #system-log, #firmware-picker');
        locked.forEach(element => { element.inert = true; });
        this.render();
        this.setProgress(0);
        this.status('Preparing ring…');
        try {
            UI.stopActivityMonitoring();
            if (RingController.heartRateTimer !== null) await UI.stopHeartRate(true);
            if (RingController.rawDataEnabled) await BLE.setRawMonitoring(false);
            // Drain queued monitor commands before switching the GATT transport to OTA.
            await BLE.queueOperation(async () => {});
            this.status('Uploading…');
            UI.addLog(`Firmware upload: ${image.name}`);
            const params = new Uint8Array(9);
            const header = new DataView(params.buffer);
            params[0] = 1;
            header.setUint32(1, image.bytes.length, true);
            header.setUint16(5, Utils.crc16(image.bytes), true);
            header.setUint16(7, image.bytes.reduce((sum, byte) => (sum + byte) & 0xffff, 0), true);
            await this.send(write, 1, null);
            await this.send(write, 2, params);
            for (let offset = 0; offset < image.bytes.length; offset += 1024) {
                const block = image.bytes.subarray(offset, offset + 1024);
                const payload = new Uint8Array(block.length + 2);
                new DataView(payload.buffer).setUint16(0, offset / 1024 + 1, true);
                payload.set(block, 2);
                await this.send(write, 3, payload);
                this.setProgress((offset + block.length) / image.bytes.length * 100);
            }
            UI.addLog('OTA data blocks acknowledged · sending command 4');
            await this.send(write, 4, null);
            verification.finalizingAt = performance.now();
            this.verification = verification;
            UI.addLog('OTA TX command 5 · waiting for ring restart');
            await this.send(write, 5, null, false);
            this.status('Transfer complete · reconnect to check running version');
            UI.addLog('OTA command 5 write returned. Reconnect after restart to read the running version.');
        } catch (error) {
            if (this.verification?.reconnected) {
                this.status('Link dropped during final command · reconnect to check running version');
                UI.addLog(`OTA command 5 write did not finish: ${error.message}`);
            } else {
                this.verification = null;
                this.status(`Upload interrupted: ${error.message}`);
                UI.addLog(`Firmware upload interrupted: ${error.message}`);
            }
        } finally {
            this.active = false;
            locked.forEach(element => { element.inert = false; });
            this.render();
        }
    }
};
