"use strict";

class RingGestureMonitor {
    constructor(learner) {
        this.learner = learner;
        this.liveTime = -Infinity;
        this.panels = [...document.querySelectorAll('[data-gesture-monitor]')].map(section => {
            section.innerHTML = `
                <div class="lab-line"><h3>Gesture monitor</h3><a href="#learned-gestures" class="gesture-map-link">Gesture map</a></div>
                <div class="gesture-monitor-live">
                    <output class="gesture-monitor-status" aria-live="polite"></output>
                    <output class="gesture-monitor-last"></output>
                    <meter min="0" max="1.3" low="0" high=".65" optimum="0" hidden aria-label="Template distance. Lower means closer."></meter>
                    <canvas width="232" height="72" aria-label="Latest live gesture fingerprint" hidden></canvas>
                </div>
                <div class="lab-line gesture-monitor-controls">
                    <label>Recorded gesture <select></select></label>
                    <small class="gesture-fingerprint-key"><span>− acceleration</span><span>+ acceleration</span></small>
                </div>
                <div class="gesture-fingerprints"></div>`;
            const select = section.querySelector('select');
            section.querySelector('a').addEventListener('click',event => {
                event.preventDefault();
                document.querySelector('[data-pane="mapping"]').click();
                document.getElementById('learned-gestures').scrollIntoView({block:'start'});
            });
            select.addEventListener('change',() => {
                this.selected = this.learner.gestures[Number(select.value)];
                this.render();
            });
            return {section,select,status:section.querySelector('.gesture-monitor-status'),
                last:section.querySelector('.gesture-monitor-last'),meter:section.querySelector('meter'),
                live:section.querySelector('canvas'),cards:section.querySelector('.gesture-fingerprints')};
        });
    }

    catalogChanged() {
        const catalog = this.learner.gestures;
        if (!catalog.includes(this.selected)) this.selected = catalog.find(gesture => gesture.examples.length) ?? catalog[0];
        for (const panel of this.panels) {
            panel.select.replaceChildren(...catalog.map((gesture,i) => new Option(gesture.name,String(i))));
            panel.select.disabled = !catalog.length;
        }
        this.render();
    }

    begin(training) {
        this.attempt = {state:training ? 'training' : 'tracking'};
        this.liveTime = -Infinity;
        this.render();
    }

    track(example, result, time) {
        this.liveTime = time;
        if (!example) return;
        this.attempt = {state:'tracking',example,result};
        this.render();
    }

    finish(example,result) {
        this.attempt = {example,result,state:result.gesture ? 'matched' : 'rejected'};
        if (result.gesture) {
            this.last = {gesture:result.gesture,time:new Date()};
            this.selected = result.gesture;
        } else if (result.closest?.gesture) {
            this.selected = result.closest.gesture;
        }
        this.render();
    }

    idle() {
        if (this.attempt?.state === 'tracking' || this.attempt?.state === 'training') this.attempt = null;
    }

    refreshStatus() {
        const attempt = this.attempt;
        let state = attempt?.state ?? 'idle';
        let status;
        if (!this.learner.enabled.checked && state !== 'training') {
            state = 'idle';
            status = 'Recognition is off. Enable it in Gesture map.';
        } else if (state === 'matched') status = `Matched · ${attempt.result.gesture.name}`;
        else if (state === 'rejected') status = attempt.result.reason;
        else if (state === 'training') status = 'Recording example…';
        else if (state === 'tracking') {
            const candidate = attempt.result?.closest ?? attempt.result;
            status = candidate?.gesture ? `Tracking · closest so far: ${candidate.gesture.name}` : 'Tracking gesture…';
        } else if (!RingController.rawDataEnabled) status = 'Start the ring stream to recognize gestures.';
        else status = ({
            motion:'Listening for motion',squeeze:'Waiting for a squeeze',hold:'Hold Space in Mapping to mark a gesture'
        })[this.learner.boundary.value];
        for (const panel of this.panels) {
            if (panel.status.textContent !== status) panel.status.textContent = status;
            if (panel.section.dataset.matchState !== state) panel.section.dataset.matchState = state;
        }
    }

    render() {
        this.refreshStatus();
        const examples = this.selected?.examples ?? [];
        const attempt = this.attempt;
        const match = attempt?.result?.closest ?? attempt?.result;
        const peak = Math.max(.2,...examples.flat(2).map(Math.abs),...(attempt?.example ?? []).flat().map(Math.abs));
        for (const panel of this.panels) {
            const index = this.learner.gestures.indexOf(this.selected);
            if (index >= 0) panel.select.value = String(index);
            panel.last.textContent = this.last ? `Last match · ${this.last.gesture.name} · ${this.last.time.toLocaleTimeString()}` : 'No accepted match yet';
            panel.meter.hidden = !Number.isFinite(match?.distance);
            if (!panel.meter.hidden) {
                panel.meter.value = match.distance;
                panel.meter.title = `Distance ${match.distance.toFixed(2)} · limit 0.65`;
                panel.meter.setAttribute('aria-valuetext',panel.meter.title);
            }
            panel.live.hidden = !attempt?.example;
            if (!panel.live.hidden) this.draw(panel.live,attempt.example,peak);
            panel.cards.replaceChildren(...examples.map((example,i) => {
                const card = document.createElement('figure');
                card.toggleAttribute('data-nearest',match?.gesture === this.selected && match?.index === i);
                const caption = document.createElement('figcaption');
                caption.textContent = card.hasAttribute('data-nearest') ? `Example ${i+1} · closest` : `Example ${i+1}`;
                const canvas = document.createElement('canvas');
                Object.assign(canvas,{width:232,height:72});
                canvas.setAttribute('aria-label',`${this.selected.name}, sample ${i+1}, XYZ fingerprint`);
                this.draw(canvas,example,peak);
                card.append(caption,canvas);
                return card;
            }));
            if (!examples.length) panel.cards.textContent = 'Record examples in Gesture map to compare them here.';
        }
    }

    draw(canvas,example,peak) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a1321';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.font = '11px monospace';
        const spacing = (canvas.width-21)/example.length;
        for (let axis = 0; axis < 3; axis++) {
            ctx.fillStyle = '#a5b6ca';
            ctx.fillText('XYZ'[axis],4,axis*22+16);
            example.forEach((point,i) => {
                const value = point[axis]/peak;
                ctx.fillStyle = value >= 0 ? `rgba(150,248,209,${.10+.9*value})` :
                    `rgba(195,167,255,${.10-.9*value})`;
                ctx.fillRect(18+i*spacing,axis*22+4,spacing-1.5,17);
            });
        }
    }
}
