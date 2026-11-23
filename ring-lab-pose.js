"use strict";

class RingLabPose {
    static normalize(vector) {
        if (!vector) return null;
        const length = Math.hypot(...vector);
        return length > .05 ? vector.map(value => value / length) : null;
    }

    static dot(a, b) {
        return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    }

    static tangent(vector, normal) {
        const depth = this.dot(vector, normal);
        return vector.map((value, i) => value - depth * normal[i]);
    }

    constructor() {
        this.recenter([0,0,1]);
    }

    recenter(gravity) {
        this.neutral = RingLabPose.normalize(gravity);
        const axis = Math.abs(this.neutral[0]) < .9 ? [1,0,0] : [0,1,0];
        this.setRight(RingLabPose.tangent(axis, this.neutral));
        this.direction = [1,0];
    }

    setRight(tangent) {
        this.right = RingLabPose.normalize(tangent);
        const [x,y,z] = this.neutral, [rx,ry,rz] = this.right;
        this.up = [y*rz-z*ry, z*rx-x*rz, x*ry-y*rx];
    }

    markRight(gravity) {
        const current = RingLabPose.normalize(gravity);
        const depth = RingLabPose.dot(current, this.neutral);
        // A 15–75 degree pose gives a usable screen-right axis.
        if (depth < Math.cos(75*Math.PI/180) || depth > Math.cos(15*Math.PI/180)) return false;
        this.setRight(RingLabPose.tangent(current, this.neutral));
        return true;
    }

    angles(gravity) {
        const current = RingLabPose.normalize(gravity);
        if (!current) return [0,0];
        const horizontal = RingLabPose.dot(current, this.right);
        const vertical = RingLabPose.dot(current, this.up);
        const magnitude = Math.hypot(horizontal, vertical);
        const angle = Math.atan2(magnitude, RingLabPose.dot(current, this.neutral));
        if (magnitude > .005) this.direction = [horizontal / magnitude, vertical / magnitude];
        return this.direction.map(value => value * angle);
    }
}
