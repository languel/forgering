"use strict";

const MidiMaps = {
    key: 'ring-studio-midi-maps-v1',
    params: ['x','y','z','blood','hrs','hr','gesture','steps','calories','distance'],
    configs: {},
    history: {},
    heldNotes: {},
    labels: {x:'Accel X (G)',y:'Accel Y (G)',z:'Accel Z (G)',blood:'Blood raw',hrs:'HRS raw',
        hr:'Heart rate',gesture:'Other ring gestures',steps:'Steps',calories:'Calories',distance:'Distance'},

    defaults(param) {
        const ranges = {x:[-4,4],y:[-4,4],z:[-4,4],blood:[0,4000],hrs:[0,4000],hr:[40,180],
            gesture:[0,6],steps:[0,10000],calories:[0,1000],distance:[0,10000]};
        const [min,max] = ranges[param];
        return {min,max,outMin:0,outMax:127,smoothing:0,on:Number((min+(max-min)*.7).toFixed(3)),off:Number((min+(max-min)*.5).toFixed(3)),duration:250,spark:true};
    },
    init() {
        this.freeze = document.getElementById('midi-freeze');
        this.status = document.getElementById('midi-map-status');
        this.picker = document.getElementById('midi-map-select');
        this.name = document.getElementById('midi-map-name');
        const table = document.querySelector('.midi-mappings table');
        const header = document.createElement('th');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = 'Live MIDI';
        toggle.title = 'Turn off all live MIDI rows, including gesture routes';
        toggle.onclick = () => {
            this.params.forEach(param => {
                document.getElementById(`midi-${param}-live`).checked = false;
                this.stop(param);
            });
            [...GestureLearning.builtins,...GestureLearning.gestures].forEach(row => { row.midiLive = false; });
            GestureLearning.save();
            GestureLearning.render();
            this.status.textContent = 'All live MIDI rows off.';
        };
        header.append(toggle);
        const learnHeader = document.createElement('th');
        learnHeader.textContent = 'MIDI learn';
        table.tHead.rows[0].append(header,learnHeader);
        for (const [index,param] of this.params.entries()) {
            this.configs[param] = this.defaults(param);
            const row = table.tBodies[0].insertRow();
            row.innerHTML = `<td><button type="button" class="midi-edit" aria-expanded="false">${this.labels[param]}</button></td>
                <td id="midi-${param}-data">—</td><td id="midi-${param}-value">0</td>
                <td><select id="midi-${param}-type" aria-label="Event for ${this.labels[param]}">
                <option value="cc">CC</option><option value="threshold">Threshold note</option><option value="pulse">Timed note</option></select></td>
                <td><input id="midi-${param}-cc" type="number" min="0" max="127" value="${20+index}" aria-label="CC or note number for ${this.labels[param]}"></td>
                <td><input id="midi-${param}-live" type="checkbox" checked aria-label="Live MIDI for ${this.labels[param]}"></td>
                <td><button type="button" aria-label="Send MIDI once for ${this.labels[param]}">Send once</button></td>`;
            if(['gesture','steps','calories','distance'].includes(param))document.getElementById(`midi-${param}-type`).value='pulse';
            if(['blood','hrs'].includes(param))document.getElementById(`midi-${param}-live`).checked=false;
            const legacyNumbers={x:20,y:21,z:22,hr:23,gesture:24,steps:25,calories:26,distance:27,blood:28,hrs:29};
            document.getElementById(`midi-${param}-cc`).value=legacyNumbers[param];
            const detail = table.tBodies[0].insertRow();
            detail.hidden = true;
            detail.className = 'midi-row-editor';
            const cell = detail.insertCell();
            cell.colSpan = 7;
            const controls = document.createElement('div');
            controls.className = 'midi-row-fields';
            const fields = {min:'Input min',max:'Input max',outMin:'CC trim min',outMax:'CC trim max',
                smoothing:'Smoothing %',on:'Note on above',off:'Note off below',duration:'Note duration (ms)'};
            for (const [key,label] of Object.entries(fields)) {
                const wrap = document.createElement('label'),input = document.createElement('input');
                wrap.textContent = label;
                Object.assign(input,{type:'number',step:key==='min'||key==='max'||key==='on'||key==='off'?'any':'1',
                    value:this.configs[param][key]});
                input.dataset.setting = key;
                input.setAttribute('aria-label',`${label} for ${this.labels[param]}`);
                input.onchange = () => {
                    const next = {...this.configs[param],[key]:input.valueAsNumber};
                    if (!this.validConfig(next)) { input.value=this.configs[param][key];return; }
                    this.stop(param);
                    this.configs[param]=next;
                    if (['x','y','z'].includes(param)) Signals.settings[param]={min:next.min,max:next.max,smoothing:next.smoothing};
                    this.drawSpark(param);
                };
                wrap.append(input);controls.append(wrap);
            }
            const sparkLabel=document.createElement('label'),sparkToggle=document.createElement('input');
            sparkToggle.type='checkbox';sparkToggle.checked=true;
            sparkLabel.append(sparkToggle,' Sparkline');
            const canvas=document.createElement('canvas');
            canvas.width=840;canvas.height=190;canvas.className='midi-spark';
            canvas.setAttribute('aria-label',`Signal and draggable range and threshold lines for ${this.labels[param]}`);
            sparkToggle.onchange=()=>{this.configs[param].spark=sparkToggle.checked;canvas.hidden=!sparkToggle.checked;};
            const hint=document.createElement('p');hint.className='hint';hint.textContent='Drag the labeled lines to change input range or note thresholds.';
            cell.append(controls,sparkLabel,hint,canvas);
            row.querySelector('.midi-edit').onclick = event => {
                for (const item of table.querySelectorAll('.midi-row-editor')) if (item!==detail) item.hidden=true;
                for (const button of table.querySelectorAll('.midi-edit')) button.setAttribute('aria-expanded','false');
                detail.hidden=!detail.hidden;
                event.currentTarget.setAttribute('aria-expanded',String(!detail.hidden));
                this.drawSpark(param);
            };
            document.getElementById(`midi-${param}-live`).onchange=()=>this.stop(param);
            for(const suffix of ['type','cc'])document.getElementById(`midi-${param}-${suffix}`).addEventListener('change',()=>this.stop(param));
            row.cells[6].querySelector('button').onclick=()=>{
                this.stop(param);
                const type=document.getElementById(`midi-${param}-type`).value;
                this.send(type==='cc'?'cc':'note',Number(document.getElementById(`midi-${param}-cc`).value),this.labels[param],this.configs[param].duration);
            };
            this.history[param]=[];
            this.configs[param]._cell=cell;
            this.installDrag(param,canvas);
            document.getElementById(`midi-${param}-type`).addEventListener('change',()=>this.refreshEditor(param));
            this.refreshEditor(param);
        }
        DOM.midiChannel.addEventListener('change',()=>this.params.forEach(param=>this.stop(param)));
        DOM.midiOutput.addEventListener('change',()=>this.params.forEach(param=>this.stop(param)));
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
        const held=this.heldNotes[param];
        if(held) {
            try { held.output.send([0x80+held.channel,held.note,0]); } catch(error) { UI.addLog(`Note release failed: ${error.message}`); }
            delete this.heldNotes[param];
        }
        clearTimeout(this.configs[param]?._timer);
        if(this.configs[param]) this.configs[param]._trigger=false;
        clearInterval(RingController.midiInterpolationTimers[param]);
        RingController.midiInterpolationTimers[param] = null;
    },

    refreshEditor(param) {
        const type=document.getElementById(`midi-${param}-type`).value;
        const cell=this.configs[param]._cell;
        for(const input of cell.querySelectorAll('[data-setting]')) {
            const key=input.dataset.setting;
            input.parentElement.hidden=(['outMin','outMax'].includes(key) && type!=='cc') ||
                (['on','off'].includes(key) && type==='cc') || (key==='duration' && type!=='pulse');
        }
        this.drawSpark(param);
    },

    validConfig(row) {
        return ['min','max','outMin','outMax','smoothing','on','off','duration'].every(key=>Number.isFinite(row[key])) &&
            row.min<row.max && row.off<row.on && row.outMin>=0 && row.outMin<=127 &&
            row.outMax>=0 && row.outMax<=127 && row.smoothing>=0 && row.smoothing<=90 &&
            row.duration>=10 && row.duration<=10000;
    },

    cleanConfig(param) {
        const row=this.configs[param];
        return Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('_')));
    },

    ingest(values) {
        if(!this.freeze) return;
        const now=performance.now();
        for(const [source,raw] of Object.entries(values)) {
            const param=source==='heart-rate'?'hr':source;
            const config=this.configs[param];
            if(!config || !Number.isFinite(raw))continue;
            const points=this.history[param];
            points.push([now,raw]);
            while(points.length>250 || now-points[0][0]>5000)points.shift();
            document.getElementById(`midi-${param}-data`).textContent=Number(raw.toFixed(3));
            this.drawSpark(param);
            if(!this.live(param))continue;
            const filtered=config._filtered===undefined?raw:config._filtered*config.smoothing/100+raw*(1-config.smoothing/100);
            config._filtered=filtered;
            const type=document.getElementById(`midi-${param}-type`).value;
            const number=Number(document.getElementById(`midi-${param}-cc`).value);
            if(!Number.isInteger(number)||number<0||number>127)continue;
            const ratio=Math.max(0,Math.min(1,(filtered-config.min)/(config.max-config.min)));
            const target=Math.round(config.outMin+ratio*(config.outMax-config.outMin));
            document.getElementById(`midi-${param}-value`).textContent=target;
            if(type==='cc') {
                MIDI.sendCC(number,target);
            } else {
                if(filtered<config.off) {
                    if(type==='threshold')this.release(param);
                    config._trigger=false;
                }
                if(filtered>config.on && !config._trigger) {
                    config._trigger=true;
                    const output=RingController.midiOutput, channel=Number(RingController.midiChannel);
                    if(!output)continue;
                    this.release(param);
                    try {
                        output.send([0x90+channel,number,100]);
                        this.heldNotes[param]={output,channel,note:number};
                        if(type==='pulse') config._timer=setTimeout(()=>this.release(param),config.duration);
                    } catch(error){UI.addLog(`MIDI note failed: ${error.message}`);}
                }
            }
        }
    },

    release(param) {
        const held=this.heldNotes[param];
        if(!held)return;
        try{held.output.send([0x80+held.channel,held.note,0]);}catch(error){UI.addLog(`Note release failed: ${error.message}`);}
        delete this.heldNotes[param];
        clearTimeout(this.configs[param]?._timer);
    },

    drawSpark(param) {
        const row=this.configs[param], canvas=row._cell.querySelector('canvas');
        if(canvas.hidden || canvas.closest('tr').hidden)return;
        const points=this.history[param],ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
        const low=Math.min(row.min,row.off,...points.map(point=>point[1]));
        const high=Math.max(row.max,row.on,...points.map(point=>point[1]));
        const pad=(high-low)*.12;
        const min=low-pad,max=high+pad;
        row._plot={min,max};
        const y=value=>h-12-(value-min)/(max-min)*(h-24);
        ctx.fillStyle='#0a1321';ctx.fillRect(0,0,w,h);
        ctx.strokeStyle='#a5f5d5';ctx.lineWidth=2;ctx.beginPath();
        const now=performance.now();
        points.forEach(([t,value],i)=>{const x=(t-now+5000)/5000*(w-130);if(i)ctx.lineTo(x,y(value));else ctx.moveTo(x,y(value));});ctx.stroke();
        ctx.font='13px monospace';
        const type=document.getElementById(`midi-${param}-type`).value;
        const lines=type==='cc'?[['min','#8295ab'],['max','#8295ab']]:
            [['min','#8295ab'],['max','#8295ab'],['on','#f7bc7c'],['off','#c5a8ff']];
        for(const [key,color] of lines){
            ctx.strokeStyle=ctx.fillStyle=color;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(0,y(row[key]));ctx.lineTo(w,y(row[key]));ctx.stroke();ctx.setLineDash([]);
            ctx.fillText(`${key} ${Number(row[key].toFixed(2))}`,w-120,y(row[key])-3);
        }
    },

    installDrag(param,canvas) {
        let selected=null,plot=null;
        canvas.onpointerdown=event=>{
            const row=this.configs[param],bounds=canvas.getBoundingClientRect(),y=(event.clientY-bounds.top)*canvas.height/bounds.height;
            plot={...row._plot};
            const value=plot.max-(y-12)/(canvas.height-24)*(plot.max-plot.min);
            selected=(document.getElementById(`midi-${param}-type`).value==='cc'?['min','max']:['min','max','on','off']).reduce((best,key)=>Math.abs(row[key]-value)<Math.abs(row[best]-value)?key:best,'min');
            canvas.setPointerCapture(event.pointerId);
        };
        canvas.onpointermove=event=>{
            if(!selected)return;
            const row=this.configs[param],bounds=canvas.getBoundingClientRect();
            const y=(event.clientY-bounds.top)*canvas.height/bounds.height;
            const value=plot.max-(y-12)/(canvas.height-24)*(plot.max-plot.min);
            const next={...row,[selected]:Number(value.toFixed(3))};
            if(!this.validConfig(next))return;
            this.stop(param);Object.assign(row,next);
            row._cell.querySelector(`[data-setting="${selected}"]`).value=next[selected];
            if(['x','y','z'].includes(param))Signals.settings[param]={min:row.min,max:row.max,smoothing:row.smoothing};
            this.drawSpark(param);
        };
        canvas.onlostpointercapture=()=>{selected=null;};
    },

    send(type,number,label,duration = RingController.noteDuration) {
        if (!RingController.midiOutput) { this.status.textContent = 'Choose a MIDI output first.'; return; }
        if (!Number.isInteger(number) || number < 0 || number > 127 || !['cc','note'].includes(type)) {
            this.status.textContent = 'Choose a CC or note and a number from 0 to 127.';
            return;
        }
        if (type === 'cc') MIDI.sendCC(number,64,true);
        else MIDI.sendNote(number,100,true,duration);
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
            const map = {name,version:2,channel:Number(DOM.midiChannel.value),
                output:RingController.midiOutput ? {id:RingController.midiOutput.id,name:RingController.midiOutput.name} : null,
                frozen:this.frozen(),signals:structuredClone(Signals.settings),
                params:Object.fromEntries(this.params.map(param => [param,{
                    type:document.getElementById(`midi-${param}-type`).value,
                    number:Number(document.getElementById(`midi-${param}-cc`).value),
                    live:document.getElementById(`midi-${param}-live`).checked,
                    config:this.cleanConfig(param)
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
        if (!map || ![1,2].includes(map.version) || !Number.isInteger(map.channel) || map.channel < 0 || map.channel > 15 ||
            typeof map.frozen !== 'boolean') throw new Error('Invalid MIDI map.');
        for (const axis of ['x','y','z']) {
            const row = map.signals?.[axis];
            if (!row || ![row.min,row.max,row.smoothing].every(Number.isFinite) || row.min >= row.max ||
                row.smoothing < 0 || row.smoothing > 90) throw new Error('Invalid acceleration ranges.');
        }
        for (const param of this.params) {
            const row = map.params?.[param];
            if (!row && map.version === 1 && ['blood','hrs'].includes(param)) continue;
            if (!row || !['cc','note','threshold','pulse'].includes(row.type) || !number(row.number) ||
                typeof row.live !== 'boolean') throw new Error('Invalid MIDI assignment.');
            if (row.config && !this.validConfig(row.config)) throw new Error('Invalid row settings.');
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

            for (const param of this.params) {
                const row = map.params[param];
                if (!row) continue;
                const legacy = ['x','y','z'].includes(param) ? map.signals[param] : {};
                const config = row.config ?? {...this.defaults(param),...legacy};
                delete this.configs[param]._filtered;
                Object.assign(this.configs[param],config);
                const cell=this.configs[param]._cell;
                cell.querySelectorAll('[data-setting]').forEach(input=>input.value=this.configs[param][input.dataset.setting]);
                const canvas=cell.querySelector('canvas');
                canvas.hidden=!config.spark;
                cell.querySelector('input[type="checkbox"]').checked=config.spark;
                document.getElementById(`midi-${param}-type`).value = row.type === 'note' ? 'pulse' : row.type;
                document.getElementById(`midi-${param}-cc`).value = row.number;
                document.getElementById(`midi-${param}-live`).checked = row.live;
                this.refreshEditor(param);
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
