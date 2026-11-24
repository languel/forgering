"use strict";

const RingLab = {
    axisColors: ['#8be8d4', '#f3be83', '#b6a8ff'],
    opticalColors: {blood: '#ff968d', hrs: '#c5a8ff'},

    init() {
        this.pane = document.getElementById('pane-lab');
        this.inkPane = document.getElementById('pane-ink');
        this.ui = Object.fromEntries([...document.querySelectorAll('#pane-lab [id^="lab-"], #pane-ink [id^="lab-"]')]
            .map(element => [element.id.slice(4), element]));
        this.signals = new RingLabSignals(event => this.event(event));
        this.synth = new RingLabSynth();
        this.trajectory = new RingLabTrajectory();
        this.inertial = new RingLabInertialStroke();
        this.initInkNavigation();
        this.view = new RingLabView(this.ui.ring, this.ui.optical, this.ui.impulse);
        this.pose = new RingLabPose();
        this.guided = new RingLabCalibration(this.ui, now => {
            const gravity = !this.demo && RingController.rawDataEnabled && this.poseSample(now);
            return gravity ? {gravity,time:this.signals.motionTime} : null;
        }, fit => {
            this.cameraFit = fit;
            this.pane.setAttribute('data-guided-pose', '');
            this.ui.hand.checked = false;
            this.ui['clock-label'].hidden = false;
            this.ui['pose-status'].textContent = fit.provisional ? 'Using the greeting pose as the upright reference.' :
                'Guided alignment drives the ring view.';
            this.stopCamera();
        });
        this.history = {blood: [], hrs: [], x: [], y: [], z: []};
        this.center = [0, 0];
        this.lastLive = -Infinity;
        this.pulseUntil = 0;

        const number = (id, fallback) => {
            const input = this.ui[id];
            return Number.isFinite(input.valueAsNumber) && input.validity.valid ? input.valueAsNumber : fallback;
        };
        this.number = number;
        for (const [id, key] of [['blood','blood'],['hrs','hrs'],['flick','flick'],['window','opticalWindow']]) {
            this.ui[id].addEventListener('change', () => {
                const thresholds = this.signals.thresholds;
                thresholds[key] = number(id, thresholds[key]);
                this.ui[id].value = thresholds[key];
                this.capture({type:'threshold', key, value:thresholds[key], time:performance.now()});
            });
        }

        const sources = [
            ['off','Fixed'], ['roll','Tilt · roll'], ['pitch','Tilt · pitch'],
            ['x','Accel X'], ['y','Accel Y'], ['z','Accel Z'],
            ['blood','Blood Δ'], ['hrs','HRS Δ'], ['energy','Motion intensity'],
            ['pressure','Squeeze strength']
        ];
        for (const id of ['pitch','filter']) this.ui[id].append(...sources.map(([value,label]) => new Option(label,value)));
        this.ui.pitch.value = 'roll';
        this.ui.filter.value = 'hrs';
        this.ui['synth-gate'].addEventListener('change', () => { this.pulseUntil = 0; });
        const audioButton = document.getElementById('learn-audio');
        const toggleAudio = async () => {
            try {
                if (this.synth.enabled) {
                    this.pulseUntil = this.mappedUntil = 0;
                    this.synth.close(.04);
                    await this.synth.context.suspend();
                } else await this.synth.enable();
                this.syncAudioButtons();
                this.refreshAudio(performance.now());
            } catch (error) { this.ui.voice.textContent = error.message; }
        };
        this.ui.audio.addEventListener('click',toggleAudio);
        audioButton.addEventListener('click',toggleAudio);
        this.ui.note.addEventListener('click', async () => {
            try {
                await this.synth.enable();
                this.syncAudioButtons();
                this.pulseUntil = performance.now()+400;
                this.refreshAudio(performance.now());
            } catch (error) { this.ui.voice.textContent = error.message; }
        });
        this.ui.demo.addEventListener('click', () => this.toggleDemo());
        this.ui.stream.addEventListener('click', () => DOM.toggleDataButton.click());
        this.ui.center.addEventListener('click', () => {
            const gravity = this.poseSample();
            if (!gravity) return;
            this.guided.stop('Switched to manual calibration.');
            this.clearCameraFit();
            this.center = this.absoluteTilt();
            this.pose.recenter(gravity);
            this.poseMarked = true;
            this.ui['pose-status'].textContent = 'Neutral set. Tilt right about 30° and mark it.';
        });
        this.ui.right.addEventListener('click', () => {
            const gravity = this.poseSample();
            if (!gravity) return;
            const marked = this.pose.markRight(gravity);
            this.ui['pose-status'].textContent = marked ? 'Right tilt set. Compare both directions with the webcam.'
                : 'Hold a right tilt between 15° and 75° from neutral.';
        });
        this.ui['reset-pose'].addEventListener('click', () => {
            this.resetPose();
            this.guided.stop('Pose reset.');
            this.ui['guided-panel'].hidden = true;
            for (const id of ['pose-scale','rest-pitch','rest-turn','rest-roll','clock']) this.ui[id].value = this.ui[id].defaultValue;
            for (const id of ['flip-right','flip-up']) this.ui[id].checked = false;
        });
        this.ui.camera.addEventListener('click', () => {
            if (this.cameraRequest) this.stopCamera();
            else void this.startCamera();
        });
        this.ui.guided.addEventListener('click', () => {
            if (this.guided.session || (this.ui.webcam.readyState >= 2 && !this.demo && RingController.rawDataEnabled)) {
                void this.guided.start();
            } else {
                this.ui['guided-panel'].hidden = false;
                this.ui['guided-step'].textContent = 'Start the webcam and the live ring stream first.';
                this.ui['guided-status'].textContent = '';
            }
        });
        const mirror = () => this.ui.webcam.toggleAttribute('data-mirror', this.ui.mirror.checked);
        this.ui.mirror.addEventListener('change', mirror);
        mirror();
        window.addEventListener('pagehide', () => this.stopCamera());
        this.ui['open-ink'].addEventListener('click', () => document.querySelector('[data-pane="ink"]').click());
        this.ui['ink-calibrate'].addEventListener('click', () => this.ui.calibrate.click());
        this.ui.clear.addEventListener('click', () => {
            const now = performance.now();
            this.trajectory.clear();
            this.inertial.clear();
            this.trajectory.setGate(this.signals.gate,now);
            this.inertial.setGate(this.signals.gate,now,this.signals.motion?.gravity);
        });
        this.ui.calibrate.addEventListener('click', () => {
            this.signals.calibrate(performance.now());
            this.ui['cal-status'].textContent = 'Keep still for 3 seconds…';
        });
        this.ui.record.addEventListener('click', () => this.record());
        this.ui.export.addEventListener('click', () => this.export());
        this.ui['gesture-map'].addEventListener('click', () => {
            document.querySelector('[data-pane="mapping"]').click();
            document.getElementById('learned-gestures').scrollIntoView({block:'start'});
        });
        this.ui.learn.addEventListener('click', () => {
            document.querySelector('[data-pane="mapping"]').click();
            document.getElementById('learn-name').focus();
        });
        window.addEventListener('ring-gesture', event => {
            if (!this.demo) this.event({type:'learned', ...event.detail, time:performance.now()});
        });
        setInterval(() => this.update(performance.now()), 40);
        const frame = now => {
            if (!this.pane.hidden) this.render(now);
            if (!this.inkPane.hidden) this.renderInk(now);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    },

    toggleDemo() {
        if (this.take) return;
        this.demo = !this.demo;
        this.guided.stop('Guided calibration uses the live ring.');
        this.demoStart = performance.now();
        this.signals.reset();
        this.trajectory.clear();
        this.inertial.clear();
        for (const points of Object.values(this.history)) points.length = 0;
        this.resetPose();
        this.pulseUntil = 0;
        this.ui.demo.setAttribute('aria-pressed', String(this.demo));
        this.ui.demo.textContent = this.demo ? 'Stop demo' : 'Demo';
        this.ui['flick-event'].textContent = '—';
        this.ui['cal-status'].textContent = 'Rest your hand before calibrating.';
        if (this.demo) this.ui.calibrate.click();
    },

    resetPose() {
        this.pose = new RingLabPose();
        this.poseMarked = false;
        this.center = [0, 0];
        this.clearCameraFit();
        this.ui['pose-status'].textContent = 'Hold still at neutral and click Recenter.';
    },

    clearCameraFit() {
        this.cameraFit = null;
        this.pane.removeAttribute('data-guided-pose');
        this.ui['clock-label'].hidden = true;
    },

    poseSample(now = performance.now()) {
        const gravity = this.signals.motion?.poseGravity;
        if (now - this.signals.motionTime > 1600 || !RingLabPose.normalize(gravity)) return null;
        return gravity;
    },

    async startCamera() {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.ui['camera-status'].textContent = 'Camera access requires localhost or HTTPS in a browser.';
            return;
        }
        const request = Symbol();
        this.cameraRequest = request;
        this.ui.camera.textContent = 'Cancel camera';
        this.ui['camera-status'].textContent = 'Waiting for camera permission…';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false, video: {width:{ideal:960}, height:{ideal:720}}
            });
            if (this.cameraRequest !== request) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.ui.webcam.srcObject = stream;
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                if (this.cameraRequest === request) this.stopCamera('Camera disconnected.');
            }, {once:true});
            this.ui['camera-panel'].hidden = false;
            this.ui.comparison.setAttribute('data-camera', '');
            await this.ui.webcam.play();
            if (this.cameraRequest !== request) return;
            this.ui.camera.textContent = 'Stop camera';
            this.ui.camera.setAttribute('aria-pressed', 'true');
            this.ui['camera-status'].textContent = 'Camera live in this tab';
        } catch (error) {
            if (this.cameraRequest !== request) return;
            const messages = {
                NotAllowedError: 'Allow camera access in your browser to start the preview.',
                NotFoundError: 'No webcam found.',
                NotReadableError: 'The webcam is unavailable or in use.'
            };
            this.stopCamera(messages[error.name] || 'Could not start the webcam.');
        }
    },

    stopCamera(message = '') {
        if (!this.cameraRequest) return;
        this.guided.stop('Camera stopped.');
        this.cameraRequest = null;
        const video = this.ui.webcam;
        video.srcObject?.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        this.ui['camera-panel'].hidden = true;
        this.ui.comparison.removeAttribute('data-camera');
        this.ui.camera.textContent = 'Start camera';
        this.ui.camera.setAttribute('aria-pressed', 'false');
        this.ui['camera-status'].textContent = message;
    },

    simulate(now) {
        const elapsed = (now - this.demoStart) / 1000;
        const t = Math.max(0, elapsed - 3.4);
        const phase = t % 5;
        const squeeze = phase > 1 && phase < 2.7 ? Math.min(1, (phase - 1) * 7, (2.7 - phase) * 8) : 0;
        const flick = Math.exp(-((phase - 3.8) ** 2) / .008) * (Math.floor(t / 5) % 2 ? -1.5 : 1.5);
        const roll = Math.sin(t * 1.9) * .47;
        const pitch = Math.sin(t * 1.3) * .31;
        const noise = 23 * Math.sin(elapsed * 13);
        this.process({x:Math.sin(roll) + flick, y:Math.sin(pitch), z:Math.cos(roll)*Math.cos(pitch),
            blood:630 + squeeze * 630 + noise, hrs:1250 + squeeze * 510 + noise * .6}, now);
    },

    ingest(values) {
        if (!this.signals || this.demo) return;
        if (![values.x, values.blood, values.hrs].some(Number.isFinite)) return;
        const now = performance.now();
        this.lastLive = now;
        this.process(values, now);
    },

    process(values, now) {
        const raw = {};
        if (RingLabSignals.axes.every(axis => Number.isFinite(values[axis]))) {
            for (const axis of RingLabSignals.axes) raw[axis] = values[axis];
        }
        for (const channel of RingLabSignals.channels) {
            if (Number.isFinite(values[channel])) raw[channel] = values[channel];
        }
        this.capture({type:'sample', ...raw, time:now});
        if (raw.x !== undefined) {
            this.signals.motionSample(raw.x, raw.y, raw.z, now);
            const {impulse,poseGravity} = this.signals.motion;
            RingLabSignals.axes.forEach((axis,i) => this.addPoint(axis, impulse[i], now));
            if (this.signals.gate) {
                const transform = vector => this.trajectoryAxes(vector,poseGravity);
                const point = this.trajectory.sample(transform(impulse),now,this.number('ink-gain',24));
                if (point) this.capture({type:'trajectory', position:point.position, time:now});
                const integrated = this.inertial.integrate([raw.x,raw.y,raw.z],this.signals.motion.gravity,
                    transform,now,this.ui['ink-gravity'].value === 'follow');
                if (integrated) this.capture({type:'integrated-trajectory', metres:integrated.position, time:now});
            }
        }
        for (const channel of RingLabSignals.channels) {
            if (raw[channel] === undefined) continue;
            this.signals.opticalSample(channel, raw[channel], now);
            this.addPoint(channel, raw[channel], now);
        }
    },

    addPoint(key, value, now) {
        const points = this.history[key];
        points.push([now,value]);
        while (points.length && (now - points[0][0] > 5100 || points.length > 1800)) points.shift();
    },

    trajectoryAxes(impulse, gravity) {
        if (this.cameraFit) {
            const math = RingLabCalibration;
            const {frame} = math.orientation(this.cameraFit,gravity,1,this.ui.mirror.checked);
            return math.apply(frame,math.apply(this.cameraFit.matrix,impulse));
        }
        const [x,y,z] = impulse;
        return [x*(this.ui['flip-right'].checked ? -1 : 1),y*(this.ui['flip-up'].checked ? -1 : 1),z];
    },

    ringGesture(code, name) {
        if (!this.demo && this.signals) this.event({type:code === 4 ? 'camera' : 'ring', code, name, time:performance.now()});
    },

    stopLive() {
        if (!this.signals || this.demo) return;
        this.guided.stop('Ring stream stopped.');
        MidiMaps.suspend();
        this.pulseUntil = 0;
        this.signals.reset();
        this.lastLive = -Infinity;
        this.ui['cal-status'].textContent = 'Rest your hand before calibrating.';
        this.refreshAudio(performance.now());
    },

    event(event) {
        const {type,time} = event;
        if (type === 'squeeze') {
            if (!this.demo) GestureLearning.squeeze(event.on,time);
            this.trajectory.setGate(event.on,time);
            this.inertial.setGate(event.on,time,this.signals.motion?.gravity);
            this.ui.gate.toggleAttribute('data-on', event.on);
            this.ui.gate.textContent = event.on ? 'Gate on' : 'Gate off';
        }
        const route = GestureLearning.builtIn(type);
        if (route?.enabled === false) return;
        this.capture(type === 'calibration' ? {...event, baseline:this.signals.baseline} : event);
        if (type === 'calibration') {
            const {blood, hrs} = this.signals.baseline ?? {};
            this.ui['cal-status'].textContent = event.ok ? `Rest · Blood ${Math.round(blood)} / HRS ${Math.round(hrs)}` : 'Need at least 3 samples from each optical stream.';
        }
        let label = type === 'learned' ? `Learned · ${event.name}` : event.name;
        if (type === 'squeeze') label = event.on ? 'Squeeze on' : 'Squeeze off';
        if (type === 'flick') {
            const direction = (event.sign > 0 ? '+' : '−') + event.axis.toUpperCase();
            label = `Flick ${direction} · ${Math.abs(event.peak).toFixed(2)} g`;
            this.ui['flick-event'].textContent = direction;
        }
        if (label) {
            const row = document.createElement('li');
            const clock = document.createElement('time');
            clock.textContent = new Date().toLocaleTimeString();
            row.append(clock, this.demo ? `${label} · Demo` : label);
            this.ui.events.prepend(row);
            if (this.ui.events.children.length > 8) this.ui.events.lastChild.remove();
        }
        if (type === 'learned') {
            const text = `Last learned gesture · ${event.name}`;
            this.ui['last-gesture'].textContent = text;
            this.ui['ink-gesture'].textContent = event.name;
            if (Number.isInteger(event.synthNote)) this.playMappedGesture(event.synthNote,time);
        }
        if (route && (type !== 'squeeze' || event.on)) {
            GestureLearning.highlight(route);
            GestureLearning.last.textContent = `Last gesture · ${label ?? route.name}`;
            if (!this.demo) GestureLearning.sendRoute(route);
            if (Number.isInteger(route.synthNote)) this.playMappedGesture(route.synthNote,time);
        }
        if (type === 'squeeze' || type === 'flick' || type === 'camera' || type === 'learned') {
            window.dispatchEvent(new CustomEvent('ring-lab-gesture', {detail:{...event, source:this.demo ? 'demo' : 'ring'}}));
        }
        this.refreshAudio(time);
    },

    syncAudioButtons() {
        const enabled = this.synth.enabled;
        const mapping = document.getElementById('learn-audio');
        for (const button of [this.ui.audio,mapping]) button.setAttribute('aria-pressed',String(enabled));
        this.ui.audio.textContent = enabled ? 'Mute audio' : 'Enable audio';
        mapping.textContent = enabled ? 'Mute synth audio' : 'Enable synth audio';
    },

    playMappedGesture(note, now = performance.now()) {
        if (!this.synth.enabled) return false;
        this.mappedNote = note;
        this.mappedUntil = now+280;
        this.synth.close(.04);
        this.refreshAudio(now);
        return true;
    },

    absoluteTilt() {
        const gravity = this.signals.motion?.gravity;
        if (!gravity || Math.hypot(...gravity) < .1) return this.center;
        const [x,y,z] = gravity;
        return [Math.atan2(x, Math.hypot(y,z)), Math.atan2(y, Math.hypot(x,z))];
    },

    tilt() {
        return this.absoluteTilt().map((value,i) => value - this.center[i]);
    },

    modulation(source, now) {
        const {optical, thresholds, motion, motionTime} = this.signals;
        if (source === 'off') return null;
        if (source === 'blood' || source === 'hrs') {
            if (!this.signals.baseline || now - (optical[source]?.time ?? -Infinity) > thresholds.opticalWindow) return null;
            return this.signals.strength(source) / 2;
        }
        if (source === 'pressure') {
            if (!this.signals.baseline || !this.signals.opticalAvailable(now)) return null;
            return Math.min(this.signals.strength('blood'),this.signals.strength('hrs')) / 2;
        }
        if (!motion || now - motionTime > 1300) return null;
        if (source === 'roll' || source === 'pitch') return .5 + this.tilt()[source === 'roll' ? 0 : 1] / 2;
        if (source === 'energy') return Math.hypot(...motion.impulse) / 2;
        return .5 + motion.sample[RingLabSignals.axes.indexOf(source)] / 4;
    },

    refreshAudio(now) {
        if (!this.synth.enabled) {
            this.ui.voice.textContent = 'Audio off';
            return;
        }
        const mapped = now < this.mappedUntil;
        const shouldOpen = mapped || now < this.pulseUntil || (this.ui['synth-gate'].value === 'squeeze' && this.signals.gate && GestureLearning.builtIn('squeeze').enabled !== false);
        const amount = id => {
            const value = this.modulation(this.ui[id].value, now);
            return value === null ? null : Math.min(1, Math.max(0, value));
        };
        const pitch = amount('pitch'), filter = amount('filter');
        const midi = mapped ? this.mappedNote : this.number('root',48) + (pitch === null ? 0 : (pitch - .5) * 24);
        const patch = {frequency:440 * 2 ** ((midi - 69) / 12), cutoff:filter === null ? 1800 : 280 * 28 ** filter,
            attack:this.number('attack',12)/1000, wave:this.ui.wave.value};
        if (shouldOpen) {
            this.synth.open(patch);
            this.synth.modulate(patch);
        } else this.synth.close(this.number('release',450)/1000);
        this.ui.voice.textContent = shouldOpen ? `Gate on · ${Math.round(patch.frequency)} Hz · LP ${Math.round(patch.cutoff)} Hz` : 'Gate off';
    },

    update(now) {
        if (this.demo) this.simulate(now);
        this.signals.tick(now);
        if (!this.pane.hidden || !this.inkPane.hidden) GestureLearning.monitor.refreshStatus();
        this.refreshAudio(now);
        if (this.take && now - this.take.start >= 60000) this.record();
    },

    render(now) {
        const connected = RingController.isConnected;
        const streaming = connected && RingController.rawDataEnabled;
        const recent = streaming && now - this.lastLive < 1600;
        const optical = this.signals.opticalAvailable(now);
        this.ui.device.textContent = connected ? RingController.device?.name || 'Ring connected' : '';
        this.ui.stream.disabled = this.demo || !connected || DOM.toggleDataButton.disabled;
        this.ui.stream.textContent = streaming ? 'Stop stream' : 'Start stream';
        const motion = now - this.signals.motionTime <= 1600 ? this.signals.motion : null;
        const sources = [motion && 'motion', optical && 'optical'].filter(Boolean).join(' + ');
        this.ui.source.textContent = this.demo ? 'Demo · simulated signals' : !connected ? 'Waiting for ring'
            : !streaming ? 'Stream stopped' : recent && sources ? `Live · ${sources}` : 'Waiting for samples';
        const gravity = this.poseSample(now);
        this.ui.center.disabled = !gravity;
        this.ui.right.disabled = !gravity || !this.poseMarked || Boolean(this.cameraFit);
        const scale = this.number('pose-scale',1);
        const [horizontal,vertical] = this.pose.angles(gravity).map((angle,i) =>
            angle * scale * (this.ui[i ? 'flip-up' : 'flip-right'].checked ? -1 : 1));
        const degrees = value => Math.round(value * 180 / Math.PI) + '°';
        const orientation = this.cameraFit && RingLabCalibration.orientation(this.cameraFit, gravity, scale, this.ui.mirror.checked);
        this.ui.tilt.textContent = !gravity ? 'Tilt —' : orientation ? `Tilt ${Math.round(orientation.angle)}°` :
            `Tilt H ${degrees(horizontal)} · V ${degrees(vertical)}`;
        this.ui.motion.textContent = motion ? 'XYZ ' + motion.sample.map(v => v.toFixed(2)).join('  ') : 'XYZ —';
        this.ui['flick-live'].textContent = motion ? 'Impulse ' + Math.hypot(...motion.impulse).toFixed(2) + ' g' : 'Impulse —';
        for (const [channel,name] of [['blood','Blood'],['hrs','HRS']]) {
            const sample = this.signals.optical[channel];
            const fresh = sample && now - sample.time <= this.signals.thresholds.opticalWindow;
            this.ui[channel + '-read'].textContent = `${name} raw ${fresh ? Math.round(sample.value) : '—'}`;
            this.ui[channel + '-meter'].value = fresh ? Math.max(0,Math.min(2,this.signals.strength(channel))) : 0;
        }
        const strength = Math.min(this.signals.strength('blood'),this.signals.strength('hrs'));
        this.ui['squeeze-strength'].textContent = !this.signals.baseline ? 'Calibrate rest to measure squeeze strength.' :
            !optical ? 'Waiting for both optical streams.' :
            `${Math.max(0,Math.round(strength*100))}% of squeeze threshold`;
        const radians = value => value * Math.PI / 180;
        this.view.drawRing({horizontal,vertical,restPitch:radians(this.number('rest-pitch',41)),
            restTurn:radians(this.number('rest-turn',-31)),restRoll:radians(this.number('rest-roll',-21)),
            frame:orientation?.frame, palmSide:this.cameraFit?.palmSide ?? -1,
            markerClock:orientation ? radians(this.number('clock',0)) : 0,
            hand:this.ui.hand.checked,gate:this.signals.gate,optical,now});
        const opticalTraces = RingLabSignals.channels.map(channel => ({
            points:this.history[channel], color:this.opticalColors[channel],
            baseline:this.signals.baseline?.[channel], threshold:this.signals.thresholds[channel]
        }));
        const impulseTraces = RingLabSignals.axes.map((axis,i) => ({
            points:this.history[axis], color:this.axisColors[i], threshold:this.signals.thresholds.flick
        }));
        this.view.drawTrace(this.ui.optical,opticalTraces,now,true);
        this.view.drawTrace(this.ui.impulse,impulseTraces,now);
        if (this.take) this.ui.take.textContent = `Recording · ${((now-this.take.start)/1000).toFixed(1)} s · ${this.take.rows.length} rows`;
    },

    initInkNavigation() {
        const views = ['3d'];
        const select = view => {
            this.activeInkView = view;
            for (const id of views) this.ui['ink-'+id].parentElement.toggleAttribute('data-selected',id === view);
        };
        const reset = () => {
            this.ui['drawing-plane'].value = '3d';
            this.ui['drawing-view-name'].textContent = 'Free 3D';
            this.inkOrbit = {yaw:-Math.PI/4,pitch:.45};
            this.inkCameras = Object.fromEntries(views.map(id => [id,{zoom:1,x:0,y:0}]));
        };
        const zoom = (view,factor,x = .5,y = .53) => {
            const camera = this.inkCameras[view];
            const next = Math.max(.35,Math.min(12,camera.zoom*factor));
            const shift = 1-next/camera.zoom;
            camera.x += (x-.5-camera.x)*shift;
            camera.y += (y-.53-camera.y)*shift;
            camera.zoom = next;
        };
        const turn = (yaw,pitch) => {
            this.ui['drawing-plane'].value = '3d';
            this.ui['drawing-view-name'].textContent = 'Free 3D';
            this.inkOrbit.yaw = (this.inkOrbit.yaw+yaw) % (2*Math.PI);
            this.inkOrbit.pitch = Math.max(-Math.PI*.49,Math.min(Math.PI*.49,this.inkOrbit.pitch+pitch));
        };
        const pan3D = this.ui['ink-pan-3d'];
        pan3D.addEventListener('click',() => {
            const enabled = pan3D.getAttribute('aria-pressed') !== 'true';
            pan3D.setAttribute('aria-pressed',String(enabled));
            if (enabled) select('3d');
        });
        for (const view of views) {
            const canvas = this.ui['ink-'+view];
            let drag = null;
            const pan = (x,y) => {
                const camera = this.inkCameras[view];
                camera.x += x/canvas.clientWidth;
                camera.y += y/canvas.clientHeight;
            };
            canvas.addEventListener('focus',() => select(view));
            canvas.addEventListener('pointerdown',event => {
                if (!event.isPrimary || event.button !== 0) return;
                select(view);
                drag = {id:event.pointerId,x:event.clientX,y:event.clientY};
                canvas.setPointerCapture(event.pointerId);
            });
            canvas.addEventListener('pointermove',event => {
                if (drag?.id !== event.pointerId) return;
                const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
                if (view === '3d' && !event.shiftKey && pan3D.getAttribute('aria-pressed') !== 'true') turn(dx*.009,dy*.009);
                else pan(dx,dy);
                drag.x = event.clientX;
                drag.y = event.clientY;
            });
            canvas.addEventListener('lostpointercapture',() => { drag = null; });
            canvas.addEventListener('wheel',event => {
                event.preventDefault();
                const bounds = canvas.getBoundingClientRect();
                const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
                select(view);
                zoom(view,Math.exp(-event.deltaY*units*.0015),
                    (event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height);
            },{passive:false});
            canvas.addEventListener('keydown',event => {
                if (['+','=','-','_'].includes(event.key)) {
                    event.preventDefault();
                    zoom(view,event.key === '+' || event.key === '=' ? 1.25 : .8);
                    return;
                }
                const directions = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
                if (!directions[event.key]) return;
                event.preventDefault();
                const [x,y] = directions[event.key];
                if (view === '3d' && !event.shiftKey && pan3D.getAttribute('aria-pressed') !== 'true') turn(x*.12,y*.12);
                else pan(x*24,y*24);
            });
        }
        this.ui['ink-zoom-in'].addEventListener('click',() => zoom(this.activeInkView,1.25));
        this.ui['ink-zoom-out'].addEventListener('click',() => zoom(this.activeInkView,.8));
        this.ui['ink-reset-view'].addEventListener('click',() => {
            reset();
            pan3D.setAttribute('aria-pressed','false');
        });
        this.ui['drawing-plane'].addEventListener('change',() => {
            const plane = this.ui['drawing-plane'];
            const angles = {front:[0,0],back:[Math.PI,0],top:[0,-Math.PI/2],bottom:[0,Math.PI/2],
                side:[Math.PI/2,0],left:[-Math.PI/2,0],'3d':[-Math.PI/4,.45]};
            const [yaw,pitch] = angles[plane.value];
            this.inkOrbit = {yaw,pitch};
            this.ui['drawing-view-name'].textContent = plane.selectedOptions[0].textContent;
        });
        this.ui['drawing-camera'].addEventListener('click',() => {
            if (this.drawingCameraRequest) this.stopDrawingCamera();
            else void this.startDrawingCamera();
        });
        const mirror = () => this.ui['drawing-video'].toggleAttribute('data-mirror',this.ui['drawing-mirror'].checked);
        this.ui['drawing-mirror'].addEventListener('change',mirror);
        mirror();
        window.addEventListener('pagehide',() => this.stopDrawingCamera());
        reset();
        select('3d');
    },

    async startDrawingCamera() {
        const request = Symbol();
        this.drawingCameraRequest = request;
        const button = this.ui['drawing-camera'];
        const status = this.ui['drawing-camera-status'];
        button.textContent = 'Cancel webcam';
        status.textContent = 'Waiting for camera permission…';
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires localhost or HTTPS in a supported browser.');
            const stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:960},height:{ideal:720}}});
            if (this.drawingCameraRequest !== request) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            const video = this.ui['drawing-video'];
            video.srcObject = stream;
            stream.getVideoTracks()[0].addEventListener('ended',() => {
                if (this.drawingCameraRequest === request) this.stopDrawingCamera('Webcam disconnected.');
            },{once:true});
            this.ui['drawing-camera-panel'].hidden = false;
            this.ui['ink-views'].setAttribute('data-webcam','');
            await video.play();
            if (this.drawingCameraRequest !== request) return;
            button.textContent = 'Stop webcam';
            button.setAttribute('aria-pressed','true');
            status.textContent = '';
        } catch (error) {
            if (this.drawingCameraRequest !== request) return;
            const message = error.name === 'NotAllowedError' ? 'Allow webcam access in the browser to show the preview.' :
                error.name === 'NotFoundError' ? 'No webcam found.' : 'Could not start webcam. Check whether another app is using it.';
            this.stopDrawingCamera(message);
        }
    },

    stopDrawingCamera(message = '') {
        if (!this.drawingCameraRequest) return;
        this.drawingCameraRequest = null;
        const video = this.ui['drawing-video'];
        video.srcObject?.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        this.ui['drawing-camera-panel'].hidden = true;
        this.ui['ink-views'].removeAttribute('data-webcam');
        this.ui['drawing-camera'].textContent = 'Start webcam';
        this.ui['drawing-camera'].setAttribute('aria-pressed','false');
        this.ui['drawing-camera-status'].textContent = message;
    },

    renderInk(now) {
        const integrated = this.ui['ink-mode'].value === 'integrated';
        const trajectory = integrated ? this.inertial : this.trajectory;
        this.ui['ink-gain-label'].hidden = integrated;
        this.ui['ink-gravity-label'].hidden = !integrated;
        this.ui['ink-gate'].textContent = this.signals.gate ? 'Drawing' : 'Squeeze to draw';
        this.ui['ink-gate'].toggleAttribute('data-on',this.signals.gate);
        const optical = this.signals.opticalAvailable(now);
        const strength = channel => Math.max(0,Math.round(this.signals.strength(channel)*100));
        this.ui['ink-optical'].textContent = this.signals.calibration ? 'Measuring relaxed hand…' :
            !this.signals.baseline ? 'Calibrate rest with your hand relaxed.' : !optical ? 'Waiting for Blood and HRS data.' :
            `Blood ${strength('blood')}% · HRS ${strength('hrs')}% of squeeze threshold`;
        const distance = Math.round(Math.hypot(...trajectory.position)*100);
        this.ui['ink-distance'].textContent = integrated && trajectory.points.length ? `≈ ${distance} cm from stroke start` : '';
        const extent = trajectory.points.reduce((max,{position}) => Math.max(max,Math.hypot(...position)),integrated ? .18 : 1.25);
        this.view.drawInk(this.ui['ink-3d'],trajectory,extent,now,this.ui['drawing-plane'].value,this.inkOrbit,this.inkCameras['3d']);
    },

    record() {
        if (this.take) {
            this.finished = this.take;
            this.take = null;
            this.ui.take.textContent = `Saved in this page · ${this.finished.rows.length} rows`;
        } else {
            this.take = {version:1, name:this.ui.label.value.trim() || 'Gesture take', source:this.demo ? 'demo' : 'ring',
                ring:RingController.device?.name ?? null, createdAt:new Date().toISOString(), start:performance.now(),
                thresholds:{...this.signals.thresholds}, baseline:this.signals.baseline && {...this.signals.baseline}, rows:[]};
        }
        this.ui.demo.disabled = Boolean(this.take);
        this.ui.record.setAttribute('aria-pressed', String(Boolean(this.take)));
        this.ui.record.textContent = this.take ? 'Stop recording' : 'Record';
        this.ui.export.disabled = Boolean(this.take) || !this.finished?.rows.length;
    },

    capture({time,...row}) {
        if (!this.take) return;
        const elapsed = time - this.take.start;
        this.take.rows.push({ms:Math.round(elapsed * 10)/10,...row});
        if (elapsed >= 60000 || this.take.rows.length >= 12000) this.record();
    },

    export() {
        if (!this.finished?.rows.length) return;
        const {start, ...take} = this.finished;
        const url = URL.createObjectURL(new Blob([JSON.stringify(take,null,2)], {type:'application/json'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = (take.name.replace(/[^a-z0-9_-]+/gi,'-') || 'ring-take') + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url),1000);
    }
};
