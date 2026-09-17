// pcm-worklet.js — VoiceTwin Day 1 (Page 2)
// AudioWorklet that captures mic audio and resamples to 24 kHz PCM16.
//
// Why resample here: Chromium honors AudioContext({sampleRate:24000}), but
// Firefox loses echo cancellation on non-default-rate contexts and Safari
// ignores the option entirely. Per AssemblyAI browser-integration guidance we
// let the context run at the device rate and resample inside the worklet.
// Output frames are 128-sample Float32 renders; we accumulate ~20 ms of audio
// (bufferSize samples at ctx.sampleRate) before converting and posting.

class PCMResampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || 24000;
    this.bufferSize = opts.bufferSize || 480; // ~20ms at 24kHz output
    this.ratio = sampleRate / this.targetRate; // sampleRate = global in worklet scope
    this.acc = new Float32Array(0);
    this.levelEvery = opts.levelEvery || 4;   // post an amplitude level every N buffers (~80ms)
    this.levelCounter = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Day 6: cheap RMS level for the waveform UI — one message per ~80ms.
    if (++this.levelCounter >= this.levelEvery) {
      this.levelCounter = 0;
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      this.port.postMessage({ level: Math.min(1, rms * 4) }); // boost + clamp for display
    }

    // Append incoming frame to accumulator
    const next = new Float32Array(this.acc.length + input.length);
    next.set(this.acc, 0);
    next.set(input, this.acc.length);
    this.acc = next;

    // While we have enough audio for at least one output buffer, resample+emit
    while (this.acc.length >= this.bufferSize * this.ratio) {
      const inNeeded = Math.floor(this.bufferSize * this.ratio);
      const chunk = this.acc.subarray(0, inNeeded);
      this.acc = this.acc.slice(inNeeded);

      const outLength = this.bufferSize;
      const pcm16 = new Int16Array(outLength);
      const step = chunk.length / outLength;
      for (let i = 0; i < outLength; i++) {
        const idx = Math.floor(i * step);
        const s = chunk[idx] ?? 0;
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-resample-processor', PCMResampleProcessor);
