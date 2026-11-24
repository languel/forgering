"use strict";

const MidiMaps = {
    key: 'ring-studio-midi-maps-v1',
    params: ['x','y','z','hr','gesture','steps','calories','distance'],
    init() {
        this.freeze = document.getElementById('midi-freeze');
        this.status = document.getElementById('midi-map-status');
        this.picker = document.getElementById('midi-map-select');
        this.name = document.getElementById('midi-map-name');
        const table = document.querySelector('.midi-mappings table');
        for (const label of ['Live MIDI','MIDI learn']) {
            const th = document.createElement('th');
            th.textContent = label;
            table.tHead.rows[0].append(th);
        }
        for (const param of this.params) {
            const row = document.getElementById(`midi-${param}-type`).closest('tr');
            const label = row.cells[0].textContent;
            const live = document.createElement('input');
            live.type = 'checkbox';
            live.checked = true;
            live.id = `midi-${param}-live`;
            live.setAttribute('aria-label',`Live MIDI for ${label}`);
            live.addEventListener('change',() => this.stop(param));
            row.insertCell().append(live);
            const send = document.createElement('button');
            send.type = 'button';
            send.textContent = 'Send once';
            send.setAttribute('aria-label',`Send MIDI once for ${label}`);
            send.addEventListener('click',() => {
                this.stop(param);
                this.send(document.getElementById(`midi-${param}-type`).value,
                    Number(document.getElementById(`midi-${param}-cc`).value),label);
            });
            row.insertCell().append(send);
        }
        this.freeze.addEventListener('change',() => {
            this.params.forEach(param => this.stop(param));
            RingController.lastMIDIValues = {};
        });
        document.getElementById('midi-map-save').addEventListener('click',() => this.save());
        document.getElementById('midi-map-load').addEventListener('click',() => this.load());
        this.refresh();
    },

    frozen() { return document.getElementById('midi-freeze')?.checked ?? false; },
    live(param) { return !this.frozen() && document.getElementById(`midi-${param}-live`)?.checked !== false; },
    stop(param) {
        clearInterval(RingController.midiInterpolationTimers[param]);
        RingController.midiInterpolationTimers[param] = null;
    },

    send(type,number,label) {
        if (!RingController.midiOutput) { this.status.textContent = 'Choose a MIDI output first.'; return; }
        if (!Number.isInteger(number) || number < 0 || number > 127 || !['cc','note'].includes(type)) {
            this.status.textContent = 'Choose a CC or note and a number from 0 to 127.';
            return;
        }
        if (type === 'cc') MIDI.sendCC(number,64,true);
        else MIDI.sendNote(number,100,true);
        this.status.textContent = `Sent ${label} · ${type.toUpperCase()} ${number} · channel ${Number(RingController.midiChannel)+1}`;
    },

    read() {
        const maps = JSON.parse(localStorage.getItem(this.key) || '[]');
        if (!Array.isArray(maps)) throw new Error('Saved MIDI maps could not be read.');
        return maps;
    },

    refresh(selected) {
        try {
            this.picker.replaceChildren(...this.read().map(map => new Option(map.name,map.name)));
            if (selected) this.picker.value = selected;
        } catch (error) { this.status.textContent = error.message; }
    },

    route(row) {
        return {type:row.type,number:row.number,enabled:row.enabled !== false,
            midiLive:row.midiLive !== false,synthNote:row.synthNote ?? null};
    },

    save() {
        const name = this.name.value.trim();
        if (!name) { this.status.textContent = 'Name this MIDI map first.'; return; }
        try {
            const map = {name,version:1,channel:Number(DOM.midiChannel.value),
                output:RingController.midiOutput ? {id:RingController.midiOutput.id,name:RingController.midiOutput.name} : null,
                frozen:this.frozen(),signals:structuredClone(Signals.settings),
                params:Object.fromEntries(this.params.map(param => [param,{
                    type:document.getElementById(`midi-${param}-type`).value,
                    number:Number(document.getElementById(`midi-${param}-cc`).value),
                    interpolate:document.getElementById(`midi-${param}-interp`).checked,
                    live:document.getElementById(`midi-${param}-live`).checked
                }])),
                builtins:Object.fromEntries(GestureLearning.builtins.map(row => [row.id,this.route(row)])),
                learned:Object.fromEntries(GestureLearning.gestures.map(row => [row.name,this.route(row)]))};
            this.validate(map);
            const maps = this.read().filter(saved => saved.name !== name);
            maps.push(map);
            localStorage.setItem(this.key,JSON.stringify(maps));
            this.refresh(name);
            this.status.textContent = `Saved map · ${name}`;
        } catch (error) { this.status.textContent = `Could not save map · ${error.message}`; }
    },

    validate(map) {
        const number = value => Number.isInteger(value) && value >= 0 && value <= 127;
        if (!map || map.version !== 1 || !Number.isInteger(map.channel) || map.channel < 0 || map.channel > 15 ||
            typeof map.frozen !== 'boolean') throw new Error('Invalid MIDI map.');
        for (const axis of ['x','y','z']) {
            const row = map.signals?.[axis];
            if (!row || ![row.min,row.max,row.smoothing].every(Number.isFinite) || row.min >= row.max ||
                row.smoothing < 0 || row.smoothing > 90) throw new Error('Invalid acceleration ranges.');
        }
        for (const param of this.params) {
            const row = map.params?.[param];
            if (!row || !['cc','note'].includes(row.type) || !number(row.number) ||
                typeof row.live !== 'boolean' || typeof row.interpolate !== 'boolean') throw new Error('Invalid MIDI assignment.');
        }
        for (const rows of [map.builtins,map.learned]) {
            if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error('Invalid gesture routes.');
            for (const row of Object.values(rows)) {
                if (!['off','cc','note'].includes(row.type) || !number(row.number) ||
                    typeof row.enabled !== 'boolean' || typeof row.midiLive !== 'boolean' ||
                    (row.synthNote !== null && !number(row.synthNote))) throw new Error('Invalid gesture assignment.');
            }
        }
    },

    load() {
        try {
            const map = this.read().find(saved => saved.name === this.picker.value);
            this.validate(map);
            this.params.forEach(param => this.stop(param));
            this.freeze.checked = map.frozen;
            DOM.midiChannel.value = String(map.channel);
            RingController.midiChannel = map.channel;
            const outputs = [...(RingController.midi?.outputs?.values() ?? [])];
            const output = map.output && (outputs.find(row => row.id === map.output.id) ?? outputs.find(row => row.name === map.output.name));
            RingController.midiOutput = output || null;
            DOM.midiOutput.value = output?.id ?? 'none';
            RingController.lastMIDIValues = {};
            Signals.settings = structuredClone(map.signals);
            Signals.filtered = {};
            document.getElementById('signal-axis').dispatchEvent(new Event('change'));
            for (const param of this.params) {
                const row = map.params[param];
                document.getElementById(`midi-${param}-type`).value = row.type;
                document.getElementById(`midi-${param}-cc`).value = row.number;
                document.getElementById(`midi-${param}-interp`).checked = row.interpolate;
                document.getElementById(`midi-${param}-live`).checked = row.live;
            }
            GestureLearning.builtins.forEach(row => { if (map.builtins[row.id]) Object.assign(row,map.builtins[row.id]); });
            GestureLearning.gestures.forEach(row => { if (map.learned[row.name]) Object.assign(row,map.learned[row.name]); });
            GestureLearning.save();
            GestureLearning.render();
            this.name.value = map.name;
            this.status.textContent = `Loaded map · ${map.name}`+(map.output && !output ? ' · MIDI output unavailable, choose a destination.' : '');
        } catch (error) { this.status.textContent = `Could not load map · ${error.message}`; }
    }
};
