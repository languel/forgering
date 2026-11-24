"use strict";

const GestureLearning = {
    storageKey: 'ring-studio-gestures-v1',
    builtinKey: 'ring-studio-builtin-gestures-v1',
    builtins: [
        {id:'flick',name:'Directional flick',type:'off',number:60},
        {id:'camera',name:'Camera Trigger',type:'note',number:24},
        {id:'squeeze',name:'Squeeze',type:'off',number:60}
    ],
    gestures: [],
    capture: null,
    motion: null,
    previous: null,
    cooldownUntil: 0,
    points: 16,

    init() {
        this.list = document.getElementById('learn-list');
        this.status = document.getElementById('learn-status');
        this.builtinList = document.getElementById('learn-builtins');
        this.enabled = document.getElementById('learn-enabled');
        this.boundary = document.getElementById('learn-boundary');
        this.hold = document.getElementById('learn-hold');
        this.cancel = document.getElementById('learn-cancel');
        this.results = document.getElementById('learn-results');
        this.last = document.getElementById('learn-last');
        this.liveTrace = document.getElementById('learn-live-trace');
        this.evaluateButton = document.getElementById('learn-evaluate');
        this.hold.addEventListener('pointerdown',event => {
            if (!event.isPrimary || event.button !== 0 || !this.beginMarked('hold')) return;
            this.hold.setPointerCapture(event.pointerId);
        });
        this.hold.addEventListener('pointerup',() => this.endMarked('hold'));
        this.hold.addEventListener('lostpointercapture',() => this.endMarked('hold'));
        document.addEventListener('keydown',event => {
            const mapping = document.getElementById('pane-mapping');
            if (event.code !== 'Space' || event.repeat || mapping.hidden ||
                (event.target !== this.hold && event.target.closest?.('input, select, textarea, button, [contenteditable]'))) return;
            if (this.beginMarked('hold')) event.preventDefault();
        });
        document.addEventListener('keyup',event => {
            if (event.code === 'Space' && this.endMarked('hold')) event.preventDefault();
        });
        window.addEventListener('blur',() => {
            if (this.marked?.mode === 'hold') this.resetMotion();
        });
        this.boundary.addEventListener('change',() => this.resetMotion());
        this.cancel.addEventListener('click',() => this.resetMotion());
        this.evaluateButton.addEventListener('click',() => this.evaluate());
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
            if (Array.isArray(saved)) this.gestures = saved.filter(row =>
                row && typeof row.name === 'string' && Array.isArray(row.examples) &&
                row.examples.every(example => Array.isArray(example) && example.length === this.points &&
                    example.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))));
        } catch {
            this.status.textContent = 'Saved gestures could not be loaded';
        }
        try {
            const saved = JSON.parse(localStorage.getItem(this.builtinKey) || '{}');
            this.builtins = this.builtins.map(route => ({...route,...saved?.[route.id],id:route.id,name:route.name}));
        } catch {
            this.status.textContent = 'Built-in gesture settings could not be loaded';
        }
        document.getElementById('gesture-form').addEventListener('submit', event => {
            event.preventDefault();
            const field = document.getElementById('learn-name');
            const name = field.value.trim();
            if (!name || this.gestures.some(gesture => gesture.name.toLowerCase() === name.toLowerCase())) {
                this.status.textContent = 'Enter a unique gesture name';
                return;
            }
            this.gestures.push({name, examples: [], type: 'off', number: 60});
            field.value = '';
            this.save();
            this.render();
        });
        this.monitor = new RingGestureMonitor(this);
        this.enabled.addEventListener('change',() => {
            this.updateControls();
            this.monitor.refreshStatus();
        });
        this.render();
    },

    save() {
        this.results.hidden = true;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.gestures));
            localStorage.setItem(this.builtinKey,JSON.stringify(Object.fromEntries(this.builtins.map(route => [route.id,route]))));
        } catch {
            this.status.textContent = 'Could not save gestures in this browser';
            return false;
        }
        return true;
    },

    render() {
        this.updateControls();
        this.rows = new Map();
        const createRow = gesture => {
            const row = document.createElement('div');
            row.className = 'studio-row gesture-row';
            this.rows.set(gesture,row);
            row.toggleAttribute('data-matched',this.lastGesture === gesture);
            const name = document.createElement('strong');
            name.textContent = gesture.name;
            row.append(name);
            const enabledLabel = document.createElement('label');
            const enabled = document.createElement('input');
            enabled.type = 'checkbox';
            enabled.checked = gesture.enabled !== false;
            enabled.setAttribute('aria-label',`Enable ${gesture.name}`);
            enabled.onchange = () => { gesture.enabled = enabled.checked; this.save(); };
            enabledLabel.append(enabled,' Enabled');
            row.append(enabledLabel);
            if (gesture.examples) {
                const count = document.createElement('span');
                count.textContent = `${gesture.examples.length} / 8 examples`;
                const record = document.createElement('button');
                record.textContent = 'Record example';
                record.type = 'button';
                record.disabled = Boolean(this.capture) || gesture.examples.length >= 8;
                record.onclick = () => this.record(gesture);
                const undo = document.createElement('button');
                undo.textContent = 'Undo example';
                undo.disabled = Boolean(this.capture) || !gesture.examples.length;
                undo.onclick = () => {
                    gesture.examples.pop();
                    this.save();
                    this.render();
                };
                row.append(count,record,undo);
            }
            const type = document.createElement('select');
            type.title = 'MIDI event for this gesture';
            type.setAttribute('aria-label', `MIDI event for ${gesture.name}`);
            for (const [value, label] of [['off', 'MIDI off'], ['note', 'MIDI note'], ['cc', 'MIDI CC']]) type.add(new Option(label, value));
            type.value = gesture.type;
            type.onchange = () => { gesture.type = type.value; this.save(); };
            const number = document.createElement('input');
            Object.assign(number, {type: 'number', min: '0', max: '127', step: '1', value: gesture.number, title: 'MIDI note or controller number'});
            number.setAttribute('aria-label', `MIDI number for ${gesture.name}`);
            number.onchange = () => {
                if (number.value !== '' && number.validity.valid) gesture.number = Number(number.value);
                number.value = gesture.number;
                this.save();
            };
            const synthLabel = document.createElement('label');
            const synth = document.createElement('input');
            synth.type = 'checkbox';
            synth.checked = Number.isInteger(gesture.synthNote);
            synth.setAttribute('aria-label',`Internal synth for ${gesture.name}`);
            synthLabel.append(synth,' Internal synth');
            const synthNote = document.createElement('input');
            Object.assign(synthNote,{type:'number',min:0,max:127,step:1,value:gesture.synthNote ?? gesture.number ?? 60});
            synthNote.setAttribute('aria-label',`Synth note for ${gesture.name}`);
            synthNote.disabled = !synth.checked;
            synth.onchange = () => {
                synthNote.disabled = !synth.checked;
                gesture.synthNote = synth.checked ? Number(synthNote.value) : null;
                this.save();
            };
            synthNote.onchange = () => {
                if (synthNote.value !== '' && synthNote.validity.valid) gesture.synthNote = Number(synthNote.value);
                synthNote.value = gesture.synthNote;
                this.save();
            };
            const preview = document.createElement('button');
            preview.type = 'button';
            preview.textContent = 'Preview mapping';
            preview.onclick = () => {
                const played = Number.isInteger(gesture.synthNote) && RingLab.playMappedGesture(gesture.synthNote);
                this.highlight(gesture);
                this.status.textContent = played ? `Preview · ${gesture.name} · synth note ${gesture.synthNote}` :
                    Number.isInteger(gesture.synthNote) ? 'Enable synth audio to hear this mapping.' : `Preview · ${gesture.name}`;
            };
            const liveLabel = document.createElement('label');
            const live = document.createElement('input');
            live.type = 'checkbox';
            live.checked = gesture.midiLive !== false;
            live.setAttribute('aria-label',`Live MIDI for ${gesture.name}`);
            live.onchange = () => { gesture.midiLive = live.checked; this.save(); };
            liveLabel.append(live,' Live MIDI');
            const send = document.createElement('button');
            send.type = 'button';
            send.textContent = 'Send once';
            send.setAttribute('aria-label',`Send MIDI once for ${gesture.name}`);
            send.onclick = () => MidiMaps.send(gesture.type,gesture.number,gesture.name);
            row.append(type,number,liveLabel,send,synthLabel,synthNote,preview);
            if (gesture.examples) {
                const remove = document.createElement('button');
                remove.textContent = 'Delete';
                remove.title = 'Delete gesture and its examples';
                remove.disabled = Boolean(this.capture);
                remove.onclick = () => {
                    if (!confirm(`Delete ${gesture.name} and its examples?`)) return;
                    this.gestures = this.gestures.filter(item => item !== gesture);
                    this.save();
                    this.render();
                };
                row.append(remove);
                if (gesture.examples.length) row.append(this.exampleViewer(gesture));
            }
            return row;
        };
        this.monitor.catalogChanged();
        this.builtinList.replaceChildren(...this.builtins.map(createRow));
        this.list.replaceChildren(...this.gestures.map(createRow));
    },

    highlight(gesture) {
        for (const [item,row] of this.rows) row.toggleAttribute('data-matched',item === gesture);
    },

    exampleViewer(gesture) {
        const panel = document.createElement('details');
        panel.className = 'gesture-example-viewer';
        const summary = document.createElement('summary');
        summary.textContent = 'View recorded examples';
        const picker = document.createElement('select');
        picker.setAttribute('aria-label',`Recorded example for ${gesture.name}`);
        gesture.examples.forEach((_,i) => picker.add(new Option(`Example ${i+1}`,String(i))));
        const canvas = document.createElement('canvas');
        Object.assign(canvas,{width:480,height:94});
        canvas.setAttribute('aria-label',`Recorded X, Y and Z traces for ${gesture.name}`);
        const redraw = () => this.drawTrace(canvas,gesture.examples[Number(picker.value)]);
        picker.addEventListener('change',redraw);
        panel.addEventListener('toggle',() => { if (panel.open) redraw(); });
        panel.append(summary,picker,canvas);
        return panel;
    },

    drawTrace(canvas,example) {
        const ctx = canvas.getContext('2d'), {width,height} = canvas;
        ctx.fillStyle = '#101a27';
        ctx.fillRect(0,0,width,height);
        ctx.strokeStyle = '#526276';
        ctx.beginPath();
        ctx.moveTo(8,height/2);
        ctx.lineTo(width-8,height/2);
        ctx.stroke();
        const peak = Math.max(.2,...example.flat().map(Math.abs));
        ['#84e8d5','#ffb881','#c0a7ff'].forEach((color,axis) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            example.forEach((point,i) => {
                const x = 8+i*(width-16)/(example.length-1);
                const y = height/2-point[axis]/peak*(height/2-8);
                if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
            });
            ctx.stroke();
        });
    },

    updateControls() {
        this.hold.hidden = this.boundary.value !== 'hold';
        this.hold.disabled = !this.capture && !this.enabled.checked;
        this.cancel.hidden = !this.capture && !this.marked;
        this.evaluateButton.disabled = Boolean(this.capture || this.marked);
    },

    record(gesture) {
        if (!RingController.rawDataEnabled) {
            this.status.textContent = 'Start the raw stream first.';
            return;
        }
        if (this.capture || this.marked) return;
        this.motion = null;
        this.previous = null;
        const mode = this.boundary.value;
        const timer = setTimeout(() => this.finishRecording(),mode === 'motion' ? 2400 : 12000);
        this.capture = {gesture,mode,motion:null,timer};
        const cue = {
            motion:'Perform it once, then return to rest.',
            hold:'Hold Space or the mark button while you perform it.',
            squeeze:'Squeeze, perform the gesture, then release.'
        };
        this.status.textContent = `${gesture.name} · ${cue[mode]}`;
        this.render();
        if (mode === 'hold') this.hold.focus();
    },

    finishRecording(motion) {
        const capture = this.capture;
        if (!capture) return;
        clearTimeout(capture.timer);
        this.capture = null;
        this.clearMarked();
        const example = this.describe(motion ?? capture.motion ?? this.motion);
        this.motion = null;
        this.previous = null;
        this.monitor.idle();
        if (example) {
            capture.gesture.examples.push(example);
            if (this.save()) this.status.textContent = `Saved ${capture.gesture.name} · example ${capture.gesture.examples.length}`;
        } else {
            this.status.textContent = 'No usable motion captured. Try the gesture again.';
        }
        this.render();
    },

    clearMarked() {
        clearTimeout(this.marked?.timer);
        this.marked = null;
        this.hold.textContent = 'Hold to mark (Space)';
    },

    resetMotion() {
        this.previous = null;
        this.latest = null;
        this.motion = null;
        const recording = this.capture || this.marked;
        this.clearMarked();
        clearTimeout(this.capture?.timer);
        this.capture = null;
        this.monitor.idle();
        if (recording) this.status.textContent = 'Recording stopped';
        this.render();
    },

    beginMarked(mode,t = performance.now()) {
        if (this.boundary.value !== mode || !RingController.rawDataEnabled || this.marked ||
            (!this.capture && !this.enabled.checked)) return false;
        const lead = this.latest && t - this.latest.t < 180 ? [this.latest] : [];
        this.marked = {mode, samples:lead, lastMovement:t, timer:setTimeout(() => this.endMarked(mode),3000)};
        // Allow a complete take even if the arm timer was about to expire.
        clearTimeout(this.capture?.timer);
        this.hold.textContent = 'Release to finish';
        this.monitor.begin(Boolean(this.capture));
        this.status.textContent = this.capture ? `Recording ${this.capture.gesture.name}…` : 'Listening to gesture…';
        this.updateControls();
        return true;
    },

    endMarked(mode,t = performance.now()) {
        const motion = this.marked;
        if (motion?.mode !== mode) return false;
        this.clearMarked();
        if (this.capture) this.finishRecording(motion);
        else {
            this.recognize(this.describe(motion),t);
            this.updateControls();
        }
        return true;
    },

    squeeze(on,t) {
        if (on) this.beginMarked('squeeze',t);
        else this.endMarked('squeeze',t);
    },

    sample(x, y, z, t = performance.now()) {
        const point = [x,y,z];
        if (!point.every(Number.isFinite)) return;
        this.latest = {point,t};
        if (this.marked) {
            const previous = this.marked.samples.at(-1);
            if (previous && Math.hypot(...point.map((value,i) => value-previous.point[i])) >= .03) {
                this.marked.lastMovement = t;
            }
            this.marked.samples.push(this.latest);
            this.trackLive(this.marked,t);
            return;
        }
        if ((!this.capture && !this.enabled.checked) || this.boundary.value !== 'motion' || this.capture?.motion) return;
        const previous = this.previous;
        this.previous = {point, t};
        if (!previous || t - previous.t > 350) {
            if (this.motion) this.monitor.idle();
            this.motion = null;
            return;
        }
        const movement = Math.hypot(...point.map((value, axis) => value - previous.point[axis]));
        if (!this.motion) {
            if (movement < 0.09 || (!this.capture && t < this.cooldownUntil)) return;
            this.motion = {samples: [previous], lastMovement: t};
            this.monitor.begin(Boolean(this.capture));
        }
        this.motion.samples.push(this.previous);
        if (movement >= 0.045) this.motion.lastMovement = t;
        this.trackLive(this.motion,t);
        if (t - this.motion.lastMovement < 220 && t - this.motion.samples[0].t < 1900) return;
        const motion = this.motion;
        this.motion = null;
        if (this.capture) {
            if (this.describe(motion)) this.capture.motion = motion;
        } else {
            this.recognize(this.describe(motion), t);
        }
    },

    trackLive(motion,time) {
        if (this.capture || time-this.monitor.liveTime < 160) return;
        const example = this.describe(motion);
        const result = example && this.match(example,this.liveCatalog());
        this.monitor.track(example,result,time);
    },

    liveCatalog() {
        return this.gestures.filter(gesture => gesture.enabled !== false && gesture.examples.length >= 2);
    },

    describe(motion) {
        if (!motion) return null;
        const {lastMovement} = motion;
        let {samples} = motion;
        if (motion.mode && samples.length) {
            const onset = samples.findIndex(({point}) => Math.hypot(...point.map((value,i) => value-samples[0].point[i])) >= .055);
            if (onset > 1) samples = samples.slice(onset-1);
        }
        if (samples.length < 4) return null;
        const start = samples[0];
        const duration = lastMovement - start.t;
        if (duration < 100) return null;
        const peak = Math.max(...samples.map(({point}) => Math.hypot(...point.map((value, axis) => value - start.point[axis]))));
        if (peak < 0.18) return null;
        let right = 1;
        return Array.from({length: this.points}, (_, index) => {
            const time = start.t + duration * index / (this.points - 1);
            while (right < samples.length - 1 && samples[right].t < time) right++;
            const left = samples[right - 1];
            const next = samples[right];
            const fraction = (time - left.t) / Math.max(1, next.t - left.t);
            return left.point.map((value, axis) => value + fraction * (next.point[axis] - value) - start.point[axis]);
        });
    },

    distance(a,b) {
        // Banded dynamic time warping retains direction while allowing local tempo changes.
        let previous = new Float64Array(b.length+1).fill(Infinity);
        previous[0] = 0;
        let energy = 0;
        for (let i = 1; i <= a.length; i++) {
            const row = new Float64Array(b.length+1).fill(Infinity);
            energy += a[i-1].reduce((sum,value,axis) => sum+(value**2+b[i-1][axis]**2)*.5,0);
            for (let j = Math.max(1,i-3); j <= Math.min(b.length,i+3); j++) {
                const cost = a[i-1].reduce((sum,value,axis) => sum+(value-b[j-1][axis])**2,0);
                row[j] = cost+Math.min(previous[j-1],previous[j],row[j-1]);
            }
            previous = row;
        }
        return Math.sqrt(previous[b.length]/Math.max(.15,energy));
    },

    match(example, catalog, skipGesture, skipExample) {
        const ranked = catalog.map(gesture => {
            let distance = Infinity, index = -1;
            for (const [i,saved] of gesture.examples.entries()) {
                if (gesture === skipGesture && saved === skipExample) continue;
                const measured = this.distance(example,saved);
                if (measured < distance) { distance = measured; index = i; }
            }
            return {gesture,distance,index};
        }).filter(item => Number.isFinite(item.distance)).sort((a,b) => a.distance-b.distance);
        const [best,next] = ranked;
        if (!best) return {reason:'Add at least two examples of a gesture.'};
        if (best.distance > .65) return {closest:best,reason:`No match · closest was ${best.gesture.name}, too far away`};
        if (next && next.distance-best.distance < .10) return {closest:best,reason:`Uncertain · ${best.gesture.name} or ${next.gesture.name}`};
        return best;
    },

    evaluate() {
        const catalog = this.gestures.filter(gesture => gesture.examples.length >= 2);
        this.results.replaceChildren();
        this.results.hidden = false;
        if (catalog.length < 2) {
            this.results.textContent = 'Add at least two gestures with two examples each to compare them.';
            return;
        }
        let correct = 0, tested = 0, rejected = 0;
        const names = catalog.map(gesture => gesture.name);
        const rows = catalog.map(gesture => {
            const counts = Array(names.length+1).fill(0);
            for (const example of gesture.examples) {
                const result = this.match(example,catalog,gesture,example);
                const index = result.gesture ? names.indexOf(result.gesture.name) : names.length;
                counts[index]++;
                tested++;
                if (result.gesture === gesture) correct++;
                if (!result.gesture) rejected++;
            }
            return [gesture.name,...counts];
        });
        const summary = document.createElement('p');
        summary.textContent = `${correct} / ${tested} correct · ${rejected} rejected · ${Math.round(100/catalog.length)}% uniform guess baseline`;
        const table = document.createElement('table');
        const append = (values,head) => {
            const row = table.insertRow();
            values.forEach((value,i) => {
                const cell = document.createElement(head || !i ? 'th' : 'td');
                cell.textContent = value;
                if (head || !i) cell.scope = head ? 'col' : 'row';
                row.append(cell);
            });
        };
        append(['Recorded gesture',...names,'Rejected'],true);
        rows.forEach(row => append(row,false));
        this.results.append(summary,table);
    },

    recognize(example,time) {
        if (!example) {
            this.status.textContent = 'No usable motion in that gesture.';
            this.monitor.finish(null,{reason:this.status.textContent});
            return;
        }
        this.liveTrace.hidden = false;
        this.drawTrace(this.liveTrace,example);
        const match = this.match(example,this.liveCatalog());
        this.monitor.finish(example,match);
        if (!match.gesture) {
            this.status.textContent = match.reason;
            return;
        }
        this.cooldownUntil = time+500;
        const {gesture,distance} = match;
        this.lastGesture = gesture;
        this.highlight(gesture);
        this.last.textContent = `Last recognized · ${gesture.name}`;
        this.status.textContent = `Recognized · ${gesture.name}`;
        UI.addLog(`Learned gesture: ${gesture.name}`);
        window.dispatchEvent(new CustomEvent('ring-gesture',{detail:{name:gesture.name,distance,synthNote:gesture.synthNote ?? null}}));
        this.sendRoute(gesture);
    },

    builtIn(type) {
        return this.builtins.find(route => route.id === type);
    },

    sendRoute(gesture) {
        if (gesture.midiLive === false || MidiMaps.frozen()) return;
        if (gesture.type === 'note') MIDI.sendNote(gesture.number);
        if (gesture.type === 'cc') {
            MIDI.sendCC(gesture.number,0);
            MIDI.sendCC(gesture.number,127);
        }
    }
};
