"use strict";

class RingLabCalibration {
    static cameraUp = [0,1,0];
    static sideAngle = 30 * Math.PI / 180;
    static prompts = [
        '1 / 3 · Wave hello. Palm to camera, fingers up.',
        '2 / 3 · Fingers sideways, thumb up, palm facing you.',
        '3 / 3 · Fingers back up. Lean your hand toward screen right.'
    ];
    static openHand = [
        [0,0],[.31,.20],[.66,.38],[.88,.56],[1,.72],
        [.34,.95],[.40,1.34],[.42,1.67],[.44,1.91],
        [0,1],[0,1.42],[0,1.79],[0,2.06],
        [-.29,.91],[-.38,1.33],[-.4,1.61],[-.44,1.85],
        [-.55,.74],[-.7,1.03],[-.76,1.25],[-.82,1.48]
    ];

    static dot(a,b) { return RingLabPose.dot(a,b); }
    static cross([ax,ay,az],[bx,by,bz]) {
        return [ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx];
    }
    static unit(vector) { return RingLabPose.normalize(vector); }
    static angle(a,b) { return Math.acos(Math.min(1, Math.max(-1, this.dot(a,b)))); }
    static degrees(radians) { return radians * 180 / Math.PI; }
    static apply(frame, vector) {
        return frame[0].map((_,i) => frame.reduce((sum,axis,j) => sum + axis[i]*vector[j],0));
    }

    static frameFromLandmarks(points) {
        if (!points || points.length !== 21) return null;
        const between = (start,end) => [points[end].x-points[start].x, points[start].y-points[end].y, points[start].z-points[end].z];
        const finger = this.unit(between(5,6).map(value => value * 10));
        if (!finger) return null;
        const across = between(17,5).map(value => value * 10);
        const normal = this.unit(this.cross(finger,across));
        return normal ? [this.cross(normal,finger),normal,finger] : null;
    }

    static axisRotation(axis, angle, point) {
        const c = Math.cos(angle), s = Math.sin(angle);
        const cross = this.cross(axis,point), projection = this.dot(axis,point)*(1-c);
        return point.map((value,i) => value*c + cross[i]*s + axis[i]*projection);
    }

    static pairMatrix(first, second) {
        const axes = (first, second) => {
            const n = this.unit(this.cross(first,second));
            return n ? [first,this.cross(n,first),n] : null;
        };
        const from = axes(first.sensor,second.sensor);
        const to = axes(first.target,second.target);
        if (!from || !to) return null;
        return [0,1,2].map(i => this.apply(to,from.map(vector => vector[i])));
    }

    static alignment(matrix, neutral, residual, provisional = false) {
        // The greeting pose faces the palm toward the camera. Either hand can be used.
        const palmSide = Math.sign(neutral[1][2]) || -1;
        return {matrix,neutral,palmSide,residual,provisional,axis:[0,0,1]};
    }

    static fallback(poses) {
        const [neutral,,right] = poses;
        const pair = this.pairMatrix(neutral,right);
        if (pair) {
            const residual = this.degrees(this.angle(this.apply(pair,right.sensor),right.target));
            if (residual <= 20) return this.alignment(pair,neutral.frame,residual,true);
        }
        const {sensor,target} = neutral;
        const angle = this.angle(sensor,target);
        const basis = [[1,0,0],[0,1,0],[0,0,1]];
        const reference = Math.abs(sensor[0]) < .8 ? basis[0] : basis[1];
        const axis = this.unit(this.cross(sensor,target)) ?? this.unit(this.cross(sensor,reference));
        const matrix = basis.map(vector => this.axisRotation(axis,angle,vector));
        return this.alignment(matrix,neutral.frame,null,true);
    }

    static fit(poses) {
        let matrix = this.pairMatrix(poses[0],poses[1]);
        if (!matrix) return null;
        const check = this.degrees(this.angle(this.apply(matrix,poses[2].sensor),poses[2].target));
        if (check > 20) return null;
        // Refine the rotation against all three gravity-vector correspondences.
        for (let i = 0; i < 45; i++) {
            const correction = [0,0,0];
            for (const {sensor,target} of poses) {
                const error = this.cross(this.apply(matrix,sensor),target);
                error.forEach((value,j) => { correction[j] += value / poses.length; });
            }
            const magnitude = Math.hypot(...correction);
            if (magnitude < .00001) break;
            const axis = correction.map(value => value / magnitude);
            matrix = matrix.map(column => this.axisRotation(axis,magnitude*.6,column));
        }
        const residual = Math.max(...poses.map(({sensor,target}) => this.degrees(this.angle(this.apply(matrix,sensor),target))));
        return residual <= 16 ? this.alignment(matrix,poses[0].frame,residual) : null;
    }

    static orientation(calibration, gravity, scale, mirror) {
        const {matrix,neutral} = calibration;
        const current = this.unit(gravity);
        const expressed = current ? this.apply(neutral,this.apply(matrix,current)) : this.cameraUp;
        const from = this.unit(expressed);
        const cross = this.cross(from,this.cameraUp);
        const magnitude = Math.hypot(...cross);
        if (magnitude > .005) calibration.axis = cross.map(value => value / magnitude);
        const angle = this.angle(from,this.cameraUp);
        const frame = neutral.map(column => this.axisRotation(calibration.axis,angle*scale,column));
        return {
            frame: mirror ? frame.map(([x,y,z]) => [-x,y,z]) : frame,
            angle:this.degrees(angle*scale)
        };
    }

    constructor(ui, sample, commit) {
        this.ui = ui;
        this.sample = sample;
        this.commit = commit;
        ui['skip-thumb'].addEventListener('click', () => {
            const session = this.session;
            if (session?.poses.length !== 1) return;
            session.poses.push(null);
            this.nextPrompt(session);
        });
    }

    async model() {
        if (!this.modelPromise) {
            const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32';
            this.modelPromise = import(base + '/vision_bundle.mjs').then(async ({FilesetResolver, HandLandmarker}) => {
                const files = await FilesetResolver.forVisionTasks(base + '/wasm');
                const model = await HandLandmarker.createFromOptions(files,{
                    baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},
                    runningMode:'VIDEO', numHands:1
                });
                this.connections = HandLandmarker.HAND_CONNECTIONS;
                return model;
            }).catch(error => { this.modelPromise = null; throw error; });
        }
        return this.modelPromise;
    }

    async start() {
        if (this.session) { this.stop('Calibration cancelled.'); return; }
        const {ui} = this;
        const session = {poses:[], held:null, lastFrame:-Infinity, lastDetection:-Infinity, deadline:performance.now()+90000};
        this.session = session;
        ui['guided-panel'].hidden = false;
        ui.guided.textContent = 'Cancel calibration';
        ui['guided-step'].textContent = 'Loading MediaPipe Hand Landmarker…';
        ui['guided-status'].textContent = 'Keep the webcam upright and your ring hand in frame.';
        ui['guided-progress'].value = 0;
        try {
            const model = await this.model();
            if (this.session !== session) return;
            session.deadline = performance.now() + 90000;
            ui['hand-overlay'].hidden = false;
            ui['guide-overlay'].hidden = false;
            ui.comparison.setAttribute('data-guiding','');
            this.nextPrompt(session);
            const frame = now => {
                if (this.session !== session) return;
                if (now > session.deadline) { this.stop('Calibration timed out. Start again when your hand is in view.'); return; }
                try {
                    if (ui.webcam.readyState >= 2 && ui.webcam.currentTime !== session.lastFrame && now-session.lastDetection >= 75) {
                        session.lastFrame = ui.webcam.currentTime;
                        session.lastDetection = now;
                        const result = model.detectForVideo(ui.webcam,now);
                        const points = result.landmarks?.[0], world = result.worldLandmarks?.[0];
                        const frame = RingLabCalibration.frameFromLandmarks(world);
                        this.draw(points, session);
                        this.acceptFrame(session,frame,now,{points,world});
                    }
                    requestAnimationFrame(frame);
                } catch (error) {
                    console.warn('Hand calibration failed',error);
                    this.stop('Hand tracking stopped. Try again, or use manual calibration.');
                }
            };
            requestAnimationFrame(frame);
        } catch (error) {
            console.warn('MediaPipe could not load',error);
            if (this.session === session) this.stop('Could not load MediaPipe. Check your connection or use manual calibration.');
        }
    }

    stop(message) {
        if (!this.session) return;
        this.session = null;
        this.ui.guided.textContent = 'Guided calibration';
        this.ui['hand-overlay'].hidden = true;
        this.ui['guide-overlay'].hidden = true;
        this.ui['skip-thumb'].hidden = true;
        this.ui.comparison.removeAttribute('data-guiding');
        this.draw();
        this.ui['guided-status'].textContent = message;
        this.ui['guided-progress'].value = 0;
    }

    nextPrompt(session) {
        session.held = null;
        session.deadline = performance.now() + 90000;
        const prompt = RingLabCalibration.prompts[session.poses.length];
        this.ui['guided-step'].textContent = prompt;
        this.ui['guide-cue'].textContent = prompt;
        this.ui['skip-thumb'].hidden = session.poses.length !== 1;
        this.ui['guided-status'].textContent = 'Match the gold target and hold still.';
        this.ui['guided-progress'].value = 0;
    }

    draw(points, session) {
        const canvas = this.ui['hand-overlay'], {videoWidth:w,videoHeight:h} = this.ui.webcam;
        if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        if (!session || !w || !h) return;
        const drawHand = (landmarks,color,dash,weight) => {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const {start,end} of this.connections) {
                ctx.moveTo(landmarks[start].x*w,landmarks[start].y*h);
                ctx.lineTo(landmarks[end].x*w,landmarks[end].y*h);
            }
            ctx.strokeStyle = 'rgba(8,15,29,.78)';
            ctx.lineWidth = weight+4;
            ctx.setLineDash(dash);
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = weight;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            for (const id of [0,4,8,12,16,20]) {
                ctx.beginPath();
                ctx.arc(landmarks[id].x*w,landmarks[id].y*h,weight*.8,0,Math.PI*2);
                ctx.fill();
            }
        };
        const target = this.guideTarget(session,points,w,h);
        if (points) drawHand(points,'#86f8cc',[],Math.max(3,w/220));
        if (target) drawHand(target,'#fff1bb',[9,7],Math.max(3,w/235));
    }

    guideTarget(session, points, width, height) {
        const math = RingLabCalibration;
        if (points) session.lastHand = points;
        const seen = points ?? session.lastHand;
        const wrist = seen?.[0] ?? {x:.5,y:.78};
        const span = (hand,a,b) => Math.hypot((hand[a].x-hand[b].x)*width,(hand[a].y-hand[b].y)*height);
        const neutral = session.neutralHand;
        const step = session.poses.length;
        if (!step || !neutral?.points || !neutral.world) {
            const size = seen ? Math.min(Math.min(width,height)*.30,span(seen,5,17)/.89) : Math.min(width,height)*.21;
            const thumb = seen && Math.abs(seen[5].x-seen[17].x) > .02
                ? Math.sign(seen[5].x-seen[17].x) : this.ui.mirror.checked ? -1 : 1;
            return math.openHand.map(([x,y]) => ({x:wrist.x+thumb*x*size/width,y:wrist.y-y*size/height}));
        }
        const {points:rest,world} = neutral;
        const palmPixels = span(rest,0,9);
        const palmWorld = Math.hypot(world[9].x-world[0].x,world[9].y-world[0].y);
        if (palmWorld < .005) return null;
        const pixelsPerMeter = palmPixels / palmWorld;
        const screenRight = this.ui.mirror.checked ? 1 : -1;
        const restFrame = session.poses[0].frame;
        const palmSide = Math.sign(restFrame[1][2]) || -1;
        const thumbUpFrame = [[0,1,0],[0,0,-palmSide],[-palmSide,0,0]];
        return world.map((point,i) => {
            const vector = [point.x-world[0].x,world[0].y-point.y,world[0].z-point.z];
            const rotated = step === 1
                ? math.apply(thumbUpFrame,restFrame.map(axis => math.dot(axis,vector)))
                : math.axisRotation([0,0,1],math.sideAngle*screenRight,vector);
            return {
                x:wrist.x+rest[i].x-rest[0].x+(rotated[0]-vector[0])*pixelsPerMeter/width,
                y:wrist.y+rest[i].y-rest[0].y-(rotated[1]-vector[1])*pixelsPerMeter/height
            };
        });
    }

    forwardPitch(frame,neutral) {
        const angle = vector => Math.atan2(vector[2],vector[1]);
        const delta = angle(frame[2])-angle(neutral[2]);
        return Math.atan2(Math.sin(delta),Math.cos(delta));
    }

    acceptFrame(session,frame,now,hand) {
        const math = RingLabCalibration;
        const sample = this.sample(now);
        const source = math.unit(sample?.gravity);
        const target = frame?.map(column => math.dot(column,math.cameraUp));
        const count = session.poses.length;
        const neutral = session.poses[0];
        let message = '';
        if (!source) message = 'Waiting for fresh ring motion.';
        else if (!target) message = 'Show one open hand in the camera.';
        else if (count === 0 && (frame[2][1] < .86 || Math.abs(frame[2][0]) > .31 || Math.abs(frame[1][2]) < .65)) message = 'Face your palm toward the camera with your fingers up.';
        else if (count === 1) {
            const palmSide = Math.sign(neutral.frame[1][2]) || -1;
            if (frame[0][1] < .66) message = 'Point your thumb up and your fingers sideways.';
            else if (frame[1][2]*palmSide > -.55) message = 'Turn your palm toward yourself.';
            else if (frame[2][0]*palmSide > -.65) message = 'Point your fingers sideways to match the gold hand.';
        } else if (count === 2) {
            const sideways = (frame[2][0]-neutral.frame[2][0])*(this.ui.mirror.checked ? -1 : 1);
            const pitch = math.degrees(this.forwardPitch(frame,neutral.frame));
            if (Math.abs(pitch) > 32) message = 'Bring your fingers back up first.';
            else if (sideways < .30) message = 'Lean toward the gold target on screen right.';
            else if (sideways > .75 || frame[2][1] < .55) message = 'Ease back toward the gold target.';
        }
        if (!message && count > 0 && session.poses.some(pose => pose && (math.angle(pose.target,target) < .18 || math.angle(pose.sensor,source) < .18))) message = 'Move a little farther from the previous poses.';
        if (message) {
            session.held = null;
            this.ui['guided-progress'].value = 0;
            this.showStatus(message);
            return;
        }
        let held = session.held;
        if (!held || math.angle(held.sensor,source) > .10 || math.angle(held.target,target) > .12 ||
            math.angle(held.frame[2],frame[2]) > .12 || math.angle(held.frame[0],frame[0]) > .12) {
            held = session.held = {start:now,sensor:source,target,frame,readings:new Map(),targets:[]};
        }
        held.readings.set(sample.time,source);
        held.targets.push(target);
        this.showStatus('Hold still…');
        this.ui['guided-progress'].value = Math.min((now-held.start)/700,held.readings.size/3,1);
        if (now-held.start < 700 || held.readings.size < 3) return;
        const average = vectors => math.unit([...vectors].reduce((sum,v) => sum.map((value,i) => value + v[i]),[0,0,0]));
        const pose = {sensor:average(held.readings.values()),target:average(held.targets),frame};
        if (count === 0) session.neutralHand = hand;
        session.poses.push(pose);
        if (session.poses.length < 3) {
            this.nextPrompt(session);
            return;
        }
        if (!session.poses[1]) {
            const fit = math.fallback(session.poses);
            this.ui['guided-step'].textContent = fit.residual === null ? 'Upright reference applied' : 'Two-pose alignment applied';
            this.stop('Thumb-up pose skipped. Depth alignment is approximate.');
            this.commit(fit);
            return;
        }
        const fit = math.fit(session.poses);
        if (!fit) {
            this.ui['guided-step'].textContent = 'Upright reference applied';
            this.stop('The poses disagreed. The view keeps your greeting pose upright. Rerun calibration for a full fit.');
            this.commit(math.fallback(session.poses));
            return;
        }
        this.ui['guided-step'].textContent = 'Guided alignment applied';
        this.stop(`Fit error: ${Math.round(fit.residual)}°. Use Marker clock to line up the LEDs if needed.`);
        this.commit(fit);
    }

    showStatus(message) {
        const status = this.ui['guided-status'];
        if (status.textContent !== message) status.textContent = message;
    }
}
