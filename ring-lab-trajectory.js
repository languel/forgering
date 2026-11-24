"use strict";

class RingLabTrajectory {
    constructor() {
        this.clear();
    }

    clear() {
        this.points = [];
        this.active = false;
        this.position = [0,0,0];
        this.velocity = [0,0,0];
        this.lastSample = -Infinity;
        this.releasedAt = -Infinity;
    }

    setGate(on, now, width) {
        if (this.active === on) return;
        this.active = on;
        this.velocity = [0,0,0];
        this.lastSample = now;
        if (on) {
            this.position = [0,0,0];
            this.points.push({time:now, position:this.position, width, start:true});
        } else this.releasedAt = now;
    }

    sample(acceleration, now, gain, width) {
        if (!this.active) return null;
        const dt = (now-this.lastSample)/1000;
        this.lastSample = now;
        if (dt <= 0 || dt > .18) {
            this.velocity = [0,0,0];
            return null;
        }

        const magnitude = Math.hypot(...acceleration);
        const input = magnitude > .065 ? Math.min(1,2/magnitude)*(1-.065/magnitude) : 0;
        const damping = Math.exp(-dt/.18);
        const previous = this.position;
        this.velocity = this.velocity.map((v,i) => v*damping + acceleration[i]*input*gain*dt);
        const next = previous.map((p,i) => p + (this.velocity[i]-p/.95)*dt);
        const extent = Math.hypot(...next);
        this.position = extent > 1.25 ? next.map(p => p*1.25/extent) : next;
        if (extent > 1.25) this.velocity = this.velocity.map(v => v*.4);
        const point = {time:now,position:this.position,width};
        this.points.push(point);
        while (this.points.length > 650 || now-this.points[0].time > 15000) this.points.shift();
        return point;
    }

    cursor(now) {
        const fade = this.active ? 1 : Math.exp(-Math.max(0,now-this.releasedAt)/160);
        return this.position.map(p => p*fade);
    }
}

class RingLabInertialStroke extends RingLabTrajectory {
    setGate(on, now, width, gravity) {
        if (this.active === on) return;
        super.setGate(on,now,width);
        if (!on) return;
        this.gravity = gravity?.slice();
        this.gravityNorm = gravity ? Math.hypot(...gravity) : 0;
        this.previousAcceleration = null;
    }

    integrate(sample, estimatedGravity, transform, now, followTilt, width) {
        if (!this.active) return null;
        const dt = (now-this.lastSample)/1000;
        this.lastSample = now;
        if (!this.gravity && estimatedGravity) {
            this.gravity = estimatedGravity.slice();
            this.gravityNorm = Math.hypot(...estimatedGravity);
        }
        if (!this.gravity || dt <= 0 || dt > .18) {
            this.velocity = [0,0,0];
            this.previousAcceleration = null;
            return null;
        }

        const magnitude = Math.hypot(...sample);
        const estimateNorm = Math.hypot(...estimatedGravity);
        if (followTilt && estimateNorm > .1 && Math.abs(magnitude-this.gravityNorm) < .14) {
            const blend = 1-Math.exp(-dt/.45);
            const estimate = estimatedGravity.map(v => v*this.gravityNorm/estimateNorm);
            const mixed = this.gravity.map((v,i) => v+(estimate[i]-v)*blend);
            const norm = Math.hypot(...mixed);
            if (norm > .1) this.gravity = mixed.map(v => v*this.gravityNorm/norm);
        }
        const linear = sample.map((v,i) => v-this.gravity[i]);
        const length = Math.hypot(...linear);
        // Soft dead zone around rest. Convert g to metres per second squared.
        const factor = length > .04 ? 9.80665 * (1-.04/length) : 0;
        const acceleration = transform(linear.map(v => v*factor));
        const previous = this.previousAcceleration ?? acceleration;
        const velocity = this.velocity.map((v,i) => v+(previous[i]+acceleration[i])*.5*dt);
        this.position = this.position.map((p,i) => p+(this.velocity[i]+velocity[i])*.5*dt);
        this.velocity = velocity;
        this.previousAcceleration = acceleration;
        const point = {time:now,position:this.position,width};
        this.points.push(point);
        while (this.points.length > 650) this.points.shift();
        return point;
    }
}
