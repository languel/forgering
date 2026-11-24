"use strict";

const RING_RADIAL_SCALE = .92;

class RingLabView {
    constructor(ring, optical, impulse) {
        this.ring = ring;
        this.optical = optical;
        this.impulse = impulse;
        this.mesh = this.buildMesh();
    }

    buildMesh() {
        const profile = [[1.03,-.30],[1.13,-.30],[1.21,-.23],[1.22,.23],
            [1.15,.30],[1.03,.30],[.98,.24],[.98,-.24]];
        const mesh = [];
        const steps = 96;
        const point = ([r, z], angle) => [Math.cos(angle) * r * RING_RADIAL_SCALE, Math.sin(angle) * r * RING_RADIAL_SCALE, z];
        for (let i = 0; i < steps; i++) {
            const a = i * Math.PI * 2 / steps;
            const b = (i + 1) * Math.PI * 2 / steps;
            for (let j = 0; j < profile.length; j++) {
                const p = profile[j], q = profile[(j + 1) % profile.length];
                const shade = j > 4 ? 0.44 : j === 2 ? 1 : 1.21;
                mesh.push({points: [point(p,a),point(p,b),point(q,b),point(q,a)], shade});
            }
        }
        return mesh;
    }

    prepare(canvas) {
        const {clientWidth: width, clientHeight: height} = canvas;
        if (!width || !height) return null;
        const scale = Math.min(devicePixelRatio || 1, 2);
        const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        return {ctx, width, height};
    }

    drawRing({horizontal, vertical, restPitch, restTurn, restRoll, frame, palmSide, markerClock, hand, gate, optical, now}) {
        const surface = this.prepare(this.ring);
        if (!surface) return;
        const {ctx, width, height} = surface;
        const f = hand ? Math.min(width*.16,height*.21) : Math.min(width*.30,height*.34);
        const distance = hand ? 7 : 3.4;
        let centerX = width / 2;
        const project = ([x,y,z]) => {
            const perspective = distance / (distance - z);
            return [centerX + x * f * perspective, height * .51 - y * f * perspective];
        };
        const line = (points, color, weight = 1) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = weight;
            ctx.beginPath();
            points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
            ctx.stroke();
        };
        const gradient = ctx.createRadialGradient(width * .52, height * .42, 0, width * .5, height * .5, Math.max(width,height) * .65);
        gradient.addColorStop(0, '#14273c');
        gradient.addColorStop(1, '#080f1d');
        ctx.fillStyle = gradient;
        ctx.fillRect(0,0,width,height);
        for (let i = -13; i <= 13; i++) {
            line([project([i*.36,-.93,1.8]),project([i*.36,-.93,-12])], '#25364b');
        }
        for (let z = -12; z < 1.85; z += .48) {
            line([project([-10,-.93,z]),project([10,-.93,z])], '#25364b');
        }

        const rx = restPitch, ry = restTurn, rz = restRoll;
        const cx = Math.cos(rx), cy = Math.cos(ry), cz = Math.cos(rz);
        const sx = Math.sin(rx), sy = Math.sin(ry), sz = Math.sin(rz);
        const angle = Math.hypot(horizontal, vertical);
        const axisX = angle > 0 ? -vertical / angle : 0;
        const axisY = angle > 0 ? horizontal / angle : 0;
        const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
        const rotate = ([x,y,z]) => {
            if (frame) return frame[0].map((value,i) => (x*value + y*frame[1][i] + z*frame[2][i])*.76);
            const yy = y*cx - z*sx;
            const zz = y*sx + z*cx;
            const xx = x*cy + zz*sy;
            const pz = zz*cy - x*sy;
            const px = xx*cz - yy*sz, py = xx*sz + yy*cz;
            const dot = axisX*px + axisY*py;
            return [
                (px*c + axisY*pz*s + axisX*dot*k)*.76,
                (py*c - axisX*pz*s + axisY*dot*k)*.76,
                (pz*c + (axisX*py - axisY*px)*s)*.76
            ];
        };
        if (hand) {
            const handProject = p => project(rotate(p));
            const bounds = [[-3.77,0,-3.08],[-3.62,.16,1.15],[-1.45,.08,2.38],[1.61,.11,-1.02],[0,0,2.24]]
                .map(point => handProject(point)[0]);
            const left = Math.min(...bounds)-f*.55, right = Math.max(...bounds)+f*.55;
            centerX += Math.max(0,10-left)-Math.max(0,right-width+10);
            this.drawHand(ctx,handProject,f);
        }
        const faces = this.mesh.map(({points, shade}) => {
            const vertices = points.map(rotate);
            const center = vertices.reduce((sum, p) => sum.map((v,i) => v+p[i]/4), [0,0,0]);
            const a = vertices[1].map((v,i) => v - vertices[0][i]);
            const b = vertices[2].map((v,i) => v - vertices[0][i]);
            const normal = [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
            const length = Math.hypot(...normal);
            const light = Math.abs((-normal[0]*.41 + normal[1]*.62 + normal[2]*.67) / length);
            const sheen = Math.max(0, -normal[0] / length) ** 5;
            return {vertices, depth:center[2], tone: Math.min(235, 36 + (light ** 2.3 * 154 + sheen * 56) * shade)};
        }).sort((a,b) => a.depth-b.depth);
        for (const {vertices,tone} of faces) {
            ctx.beginPath();
            vertices.forEach((p,i) => i ? ctx.lineTo(...project(p)) : ctx.moveTo(...project(p)));
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle = `rgb(${tone*.92},${tone},${tone*1.09})`;
            ctx.lineWidth = .7;
            ctx.fill();
            ctx.stroke();
        }
        if (hand && rotate([0,0,1])[2] > 0) {
            this.drawDigit(ctx, p => project(rotate(p)), [[0,0,.31],[0,0,1.51],[.04,.04,2.24]], f*1.05, .47);
        }
        const markerColors = ['#ff685d', '#fff1bb', '#66f4a7'];
        for (let i = 0; i < markerColors.length; i++) {
            const a = 4.39 + i*.32 + markerClock;
            const innerRadius = .96 * RING_RADIAL_SCALE;
            const p = rotate([innerRadius*Math.cos(a),-palmSide*innerRadius*Math.sin(a),.15]);
            const [x,y] = project(p);
            ctx.fillStyle = markerColors[i];
            ctx.shadowBlur = optical ? (gate ? 14 : 9) : 2;
            ctx.shadowColor = markerColors[i];
            ctx.beginPath();
            ctx.arc(x,y, i === 1 ? 4 : 2.4,0,Math.PI*2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        if (!hand) {
            const base = [30,height-49];
            ctx.font = '11px monospace';
            for (const [label,pos] of [['X',[64,height-49]],['Y',[51,height-71]],['Z',[30,height-82]]]) {
                line([base,pos],'#a5f5d5',1.2);
                ctx.fillStyle = '#a5f5d5';
                ctx.fillText(label,pos[0]+4,pos[1]-3);
            }
        }
    }

    drawInk(canvas, trajectory, extent, now, view, orbit, camera) {
        const surface = this.prepare(canvas);
        if (!surface) return;
        const {ctx,width,height} = surface;
        const scale = Math.min(width,height)*.37/extent*camera.zoom;
        const originX = width*(.5+camera.x), originY = height*(.53+camera.y);
        const {yaw,pitch} = orbit;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const flatten = ([x,y,z]) => {
            switch (view) {
                case 'front': return [x,y];
                case 'top': return [x,z];
                case 'side': return [-z,y];
                case 'back': return [-x,y];
                case 'bottom': return [x,-z];
                case 'left': return [z,y];
                default: return [x*cy-z*sy,y*cp-(x*sy+z*cy)*sp];
            }
        };
        const project = point => {
            const [x,y] = flatten(point);
            return [originX+x*scale,originY-y*scale];
        };
        ctx.fillStyle = '#0a1321';
        ctx.fillRect(0,0,width,height);
        ctx.beginPath();
        if (view === '3d') {
            for (let i = -4; i <= 4; i++) {
                const u = extent*i/4;
                ctx.moveTo(...project([u,0,-extent])); ctx.lineTo(...project([u,0,extent]));
                ctx.moveTo(...project([-extent,0,u])); ctx.lineTo(...project([extent,0,u]));
            }
        } else {
            const spacing = extent*scale/4;
            const offset = origin => ((origin%spacing)+spacing)%spacing;
            for (let x = offset(originX); x < width; x += spacing) {ctx.moveTo(x,0);ctx.lineTo(x,height);}
            for (let y = offset(originY); y < height; y += spacing) {ctx.moveTo(0,y);ctx.lineTo(width,y);}
        }
        ctx.strokeStyle = '#25364b';
        ctx.lineWidth = 1;
        ctx.stroke();

        const {points} = trajectory;
        const lastStart = Math.max(0,points.findLastIndex(point => point.start));
        ctx.lineCap = ctx.lineJoin = 'round';
        const drawPath = (begin,end,color) => {
            if (begin >= end) return;
            ctx.beginPath();
            for (let i = begin; i < end; i++) {
                const p = project(points[i].position);
                if (i === begin || points[i].start) ctx.moveTo(...p);
                else ctx.lineTo(...p);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        };
        drawPath(0,lastStart,'#548581');
        drawPath(lastStart,points.length,'#a5f5d5');

        const [x,y] = project(trajectory.cursor(now));
        ctx.strokeStyle = trajectory.active ? '#a5f5d5' : '#839ab0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x,y,trajectory.active ? 8 : 4,0,Math.PI*2);
        ctx.stroke();
        if (trajectory.active) {
            ctx.fillStyle = '#a5f5d5';
            ctx.beginPath();
            ctx.arc(x,y,3,0,Math.PI*2);
            ctx.fill();
        }
        if (view === '3d') this.drawInkAxes(ctx,flatten,height);
    }

    drawInkAxes(ctx,flatten,height) {
        ctx.font = '10px monospace';
        for (const [label,vector,color] of [
            ['X',[1,0,0],'#ff968d'],['Y',[0,1,0],'#a5f5d5'],['Z',[0,0,1],'#c5a8ff']
        ]) {
            const [dx,dy] = flatten(vector);
            const x = 35+dx*19, y = height-31-dy*19;
            ctx.beginPath();
            ctx.moveTo(35,height-31);
            ctx.lineTo(x,y);
            ctx.strokeStyle = ctx.fillStyle = color;
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.fillText(label,x+Math.sign(dx)*4,y-3);
        }
    }

    drawDigit(ctx, project, points, width, opacity) {
        ctx.save();
        ctx.lineJoin = ctx.lineCap = 'round';
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        points.forEach((point,i) => i ? ctx.lineTo(...project(point)) : ctx.moveTo(...project(point)));
        ctx.lineWidth = width;
        ctx.strokeStyle = '#579a94';
        ctx.stroke();
        ctx.lineWidth = Math.max(1,width-2);
        ctx.strokeStyle = '#254b56';
        ctx.stroke();
        ctx.restore();
    }

    drawHand(ctx, project, scale) {
        const palm = [[-3.35,0,-3.08],[-3.77,0,-2.31],[-3.56,0,-1.47],[-3.1,0,-.86],
            [-2.04,0,-.9],[-.85,0,-.84],[.54,0,-.97],[.76,0,-1.52],[.40,0,-2.12],[-.35,0,-3.00]];
        const digits = [
            {points:[[0,0,-1.52],[0,0,1.51],[.04,.04,2.24]], width:1.05},
            {points:[[-1.19,0,-1.05],[-1.32,.02,.73],[-1.45,.08,2.38]], width:.73},
            {points:[[-2.15,0,-1.13],[-2.38,.06,.51],[-2.58,.12,1.98]], width:.67},
            {points:[[-3.09,0,-1.33],[-3.48,.08,-.17],[-3.62,.16,1.15]], width:.59},
            {points:[[.28,0,-2.18],[1.02,.01,-1.87],[1.61,.11,-1.02]], width:.77}
        ];
        ctx.save();
        ctx.globalAlpha = .67;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        palm.forEach((point,i) => i ? ctx.lineTo(...project(point)) : ctx.moveTo(...project(point)));
        ctx.closePath();
        ctx.fillStyle = '#183b48';
        ctx.fill();
        ctx.strokeStyle = '#559990';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        for (const digit of digits) this.drawDigit(ctx,project,digit.points,scale*digit.width,.67);
    }

    drawTrace(canvas, traces, now, optical = false) {
        const surface = this.prepare(canvas);
        if (!surface) return;
        const {ctx,width,height} = surface;
        const left = 3, right = width-3, top = 3, bottom = height-17;
        const oldest = now - 5000;
        const x = time => left + (time-oldest)/5000*(right-left);
        ctx.fillStyle = '#0a1321';
        ctx.fillRect(0,0,width,height);
        ctx.strokeStyle = '#29384a';
        ctx.fillStyle = '#a5b6ca';
        ctx.font = '10px monospace';
        for (let i = 0; i <= 5; i++) {
            const xx = x(oldest+i*1000);
            ctx.beginPath();
            ctx.moveTo(xx,top);
            ctx.lineTo(xx,bottom);
            ctx.stroke();
            ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
            ctx.fillText(i === 5 ? 'Now' : `−${5-i}s`,xx,height-3);
        }
        for (const y of [top,(top+bottom)/2,bottom]) {
            ctx.beginPath();
            ctx.moveTo(left,y);
            ctx.lineTo(right,y);
            ctx.stroke();
        }
        const visibleTraces = traces.map(trace => {
            const visible = trace.points.filter(([t]) => t >= oldest);
            const mean = visible.length ? visible.reduce((sum, [,v]) => sum + v, 0) / visible.length : 0;
            const center = optical ? (trace.baseline ?? mean) : 0;
            return {...trace, visible, center};
        });
        const spread = visibleTraces.reduce((max, {visible,threshold,center}) => visible.reduce(
            (peak, [,value]) => Math.max(peak, Math.abs(value-center)), Math.max(max,threshold*1.3)), 0);
        for (const {visible,color,baseline,threshold,center} of visibleTraces) {
            if (!visible.length) continue;
            const y = v => (top+bottom)/2 - (v-center)/spread*(bottom-top)*.46;
            ctx.strokeStyle = color;
            ctx.globalAlpha = .55;
            if (optical && baseline !== undefined) {
                ctx.setLineDash([4,4]);
                ctx.beginPath();
                ctx.moveTo(left,y(center+threshold));
                ctx.lineTo(right,y(center+threshold));
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            visible.forEach(([t,v],i) => {
                if (i && t-visible[i-1][0] < 1400) ctx.lineTo(x(t),y(v));
                else ctx.moveTo(x(t),y(v));
            });
            ctx.stroke();
            const [time,value] = visible.at(-1);
            ctx.fillStyle = color;
            ctx.fillRect(x(time)-1,y(value)-1,3,3);
        }
    }
}
