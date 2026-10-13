/**
 * Sons UI messages — bips courts originaux (pas de assets WhatsApp).
 * node scripts/generate-message-sounds.js
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets", "sounds");
const SR = 22050;

function writeWav(filePath, samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = SR * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.floor(v * 32767 * 0.82), 44 + i * 2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function env(t, dur, attack = 0.008, release = 0.06) {
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

function sine(freq, t, vol = 1) {
  return vol * Math.sin(2 * Math.PI * freq * t);
}

function genRecordStart() {
  const dur = 0.11;
  const n = Math.floor(SR * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 480 + (920 - 480) * (t / dur);
    s[i] = sine(f, t, 0.38) * env(t, dur, 0.004, 0.035);
  }
  return s;
}

function genRecordStop() {
  const dur = 0.09;
  const n = Math.floor(SR * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 780 - (780 - 420) * (t / dur);
    s[i] = sine(f, t, 0.32) * env(t, dur, 0.003, 0.04);
  }
  return s;
}

function genSent() {
  const dur = 0.14;
  const n = Math.floor(SR * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const click = t < 0.012 ? sine(1800, t, 0.22) : 0;
    const tail = sine(640, t, 0.2) * env(t, dur, 0.002, 0.09);
    s[i] = (click + tail) * env(t, dur, 0.001, 0.05);
  }
  return s;
}

function genIncomingInChat() {
  const dur = 0.2;
  const n = Math.floor(SR * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    if (t >= 0 && t < 0.09) {
      v += sine(880, t, 0.26) * env(t, 0.09, 0.004, 0.03);
    }
    if (t >= 0.1 && t < 0.19) {
      const lt = t - 0.1;
      v += sine(660, t, 0.22) * env(lt, 0.09, 0.004, 0.035);
    }
    s[i] = v;
  }
  return s;
}

function genIncomingList() {
  const dur = 0.28;
  const n = Math.floor(SR * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = sine(740, t, 0.24) * env(t, 0.12, 0.01, 0.04);
    if (t >= 0.13 && t < 0.27) {
      const lt = t - 0.13;
      v += sine(590, t, 0.2) * env(lt, 0.14, 0.01, 0.05);
    }
    s[i] = v * env(t, dur, 0.005, 0.06);
  }
  return s;
}

const files = {
  "msg-record-start.wav": genRecordStart(),
  "msg-record-stop.wav": genRecordStop(),
  "msg-sent.wav": genSent(),
  "msg-in-chat.wav": genIncomingInChat(),
  "msg-in-list.wav": genIncomingList(),
};

for (const [name, samples] of Object.entries(files)) {
  writeWav(path.join(OUT, name), samples);
  console.log("wrote", name);
}
