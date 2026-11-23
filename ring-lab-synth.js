"use strict";

class RingLabSynth {
    async enable() {
        if (!this.context) {
            this.context = new AudioContext();
            this.master = this.context.createGain();
            this.master.gain.value = 0.16;
            this.master.connect(this.context.destination);
            this.filter = this.context.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.Q.value = 0.7;
            this.filter.connect(this.master);
        }
        await this.context.resume();
    }

    get enabled() {
        return this.context?.state === 'running';
    }

    open(patch) {
        if (!this.enabled || this.voice) return;
        const {context, filter} = this;
        const oscillator = context.createOscillator();
        oscillator.type = patch.wave;
        oscillator.frequency.value = patch.frequency;
        const amp = context.createGain();
        const now = context.currentTime;
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(1, now + patch.attack);
        amp.gain.setTargetAtTime(0.42, now + patch.attack, 0.11);
        oscillator.connect(amp).connect(filter);
        filter.frequency.setValueAtTime(patch.cutoff, now);
        oscillator.start();
        this.voice = {oscillator, amp};
    }

    modulate(patch) {
        if (!this.voice) return;
        const now = this.context.currentTime;
        this.voice.oscillator.type = patch.wave;
        this.voice.oscillator.frequency.setTargetAtTime(patch.frequency, now, 0.035);
        this.filter.frequency.setTargetAtTime(patch.cutoff, now, 0.045);
    }

    close(release) {
        if (!this.voice) return;
        const {oscillator, amp} = this.voice;
        this.voice = null;
        const now = this.context.currentTime;
        if (amp.gain.cancelAndHoldAtTime) amp.gain.cancelAndHoldAtTime(now);
        else {
            const level = amp.gain.value;
            amp.gain.cancelScheduledValues(now);
            amp.gain.setValueAtTime(level, now);
        }
        amp.gain.setTargetAtTime(0, now, release / 5);
        oscillator.stop(now + release + 0.03);
        oscillator.onended = () => { oscillator.disconnect(); amp.disconnect(); };
    }
}
