"use strict";

class RingLabSignals {
    static channels = ['blood', 'hrs'];
    static axes = ['x', 'y', 'z'];

    constructor(emit) {
        this.emit = emit;
        this.thresholds = {blood: 200, hrs: 200, flick: 0.65, opticalWindow: 1400};
        this.reset();
    }

    reset() {
        if (this.gate) this.setGate(false, performance.now());
        this.optical = {};
        this.baseline = null;
        this.calibration = null;
        this.gate = false;
        this.motion = null;
        this.motionTime = -Infinity;
        this.flickTime = -Infinity;
        this.flickReady = true;
    }

    calibrate(now) {
        this.setGate(false, now);
        this.baseline = null;
        this.calibration = {end: now + 3200, blood: [], hrs: []};
    }

    opticalSample(channel, value, now) {
        this.optical[channel] = {value, time: now};
        const capture = this.calibration;
        if (capture && now <= capture.end) capture[channel].push(value);
        this.checkGate(now);
    }

    tick(now) {
        const capture = this.calibration;
        if (capture && now >= capture.end) {
            this.calibration = null;
            if (RingLabSignals.channels.every(channel => capture[channel].length >= 3)) {
                this.baseline = Object.fromEntries(RingLabSignals.channels.map(channel => {
                    const sorted = capture[channel].sort((a, b) => a - b);
                    return [channel, sorted[Math.floor(sorted.length / 2)]];
                }));
            }
            this.emit({type: 'calibration', ok: Boolean(this.baseline), time: now});
        }
        this.checkGate(now);
    }

    opticalAvailable(now) {
        return RingLabSignals.channels.every(channel => now - (this.optical[channel]?.time ?? -Infinity) <= this.thresholds.opticalWindow);
    }

    strength(channel) {
        if (!this.baseline || !this.optical[channel]) return 0;
        return (this.optical[channel].value - this.baseline[channel]) / this.thresholds[channel];
    }

    checkGate(now) {
        if (!this.baseline || !this.opticalAvailable(now)) {
            this.setGate(false, now);
            return;
        }
        const strength = Math.min(...RingLabSignals.channels.map(channel => this.strength(channel)));
        this.setGate(strength >= (this.gate ? 0.5 : 1), now);
    }

    setGate(on, time) {
        if (this.gate === on) return;
        this.gate = on;
        this.emit({type: 'squeeze', on, time});
    }

    motionSample(x, y, z, now) {
        const sample = [x, y, z];
        const dt = now - this.motionTime;
        this.motionTime = now;
        if (!this.motion || dt > 500) {
            this.motion = {gravity: sample, poseGravity: sample, sample, impulse: [0, 0, 0]};
            this.flickReady = true;
            return;
        }
        // A slowly adapting gravity estimate keeps resting tilt out of the flick detector.
        const {gravity, poseGravity} = this.motion;
        const blend = 1 - Math.exp(-Math.max(dt, 0) / 320);
        const poseBlend = 1 - Math.exp(-Math.max(dt, 0) / 95);
        const impulse = sample.map((value, i) => value - gravity[i]);
        this.motion = {
            sample, impulse,
            gravity: gravity.map((value, i) => value + impulse[i] * blend),
            poseGravity: poseGravity.map((value, i) => value + (sample[i] - value) * poseBlend)
        };
        const axis = impulse.reduce((best, value, i) => Math.abs(value) > Math.abs(impulse[best]) ? i : best, 0);
        const peak = impulse[axis];
        if (Math.abs(peak) < this.thresholds.flick * 0.45) this.flickReady = true;
        if (this.flickReady && Math.abs(peak) >= this.thresholds.flick && now - this.flickTime >= 300) {
            this.flickReady = false;
            this.flickTime = now;
            this.emit({type: 'flick', axis: RingLabSignals.axes[axis], sign: Math.sign(peak), peak, time: now});
        }
    }
}
