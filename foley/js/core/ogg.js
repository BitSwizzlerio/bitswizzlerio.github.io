/* OGG Vorbis export. The encoder (vendor/libvorbis.js, ~2 MB asm.js) is loaded lazily on first use. */
window.Foley = window.Foley || {};
(function () {
  const Ogg = Foley.Ogg = {
    _loading: null,
    /* Resolve the vendored encoder (window.FoleyVorbis), injecting the script on first call. */
    load() {
      if (window.FoleyVorbis) return Promise.resolve(window.FoleyVorbis);
      if (Ogg._loading) return Ogg._loading;
      Ogg._loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        const base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/js\/core\/ogg\.js.*$/, '') : (Ogg.baseUrl || '');
        s.src = (Ogg.baseUrl || base || '') + 'vendor/libvorbis.js';
        s.onload = () => window.FoleyVorbis ? resolve(window.FoleyVorbis) : reject(new Error('encoder did not initialize'));
        s.onerror = () => reject(new Error('could not load vendor/libvorbis.js'));
        document.head.appendChild(s);
      });
      return Ogg._loading;
    },
    /* Encode an AudioBuffer. quality: -0.1..1 (Vorbis VBR; 0.4 ≈ q4 ≈ 128 kbps stereo). tags: { TITLE, LOOPSTART, LOOPLENGTH, ... } */
    async encode(buffer, quality, tags) {
      const L = await Ogg.load();
      const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length; const q = Math.max(-0.1, Math.min(1, quality === undefined ? 0.4 : quality));
      const enc = L._encoder_init(ch, sr, q); if (!enc) throw new Error('encoder_init failed');
      const setTag = L.cwrap('encoder_set_tag', null, ['number', 'string', 'string']);
      const t = Object.assign({ ENCODER: 'Foley Fun' }, tags || {}); Object.keys(t).forEach(k => { if (t[k] !== undefined && t[k] !== null) setTag(enc, String(k), String(t[k])); });
      L._encoder_stream_init(enc);
      const parts = []; const collect = () => { const len = L._encoder_data_len(enc); if (len > 0) { const p = L._encoder_transfer_data(enc); parts.push(new Uint8Array(L.HEAPU8.subarray(p, p + len))); } };
      collect();
      const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
      for (let i = 0; i < n; i += 4096) {
        const len = Math.min(4096, n - i); const ptr = L._encoder_analysis_buffer(enc, len) >> 2;
        for (let c = 0; c < ch; c++) L.HEAPF32.set(chans[c].subarray(i, i + len), L.HEAPU32[ptr + c] >> 2); // re-read heaps each block (memory may grow)
        L._encoder_process(enc, len); collect();
      }
      L._encoder_process(enc, 0); collect(); L._encoder_clear(enc);
      return new Blob(parts, { type: 'audio/ogg' });
    },
    /* Convert an AudioBuffer to another sample rate / channel count via an OfflineAudioContext (for 44.1 kHz / mono exports). */
    async convert(buffer, sampleRate, channels) {
      sampleRate = sampleRate || buffer.sampleRate; channels = channels || buffer.numberOfChannels;
      if (sampleRate === buffer.sampleRate && channels === buffer.numberOfChannels) return buffer;
      const len = Math.ceil(buffer.duration * sampleRate); const off = new OfflineAudioContext(channels, len, sampleRate);
      const s = off.createBufferSource(); s.buffer = buffer; s.connect(off.destination); s.start(0);
      return off.startRendering();
    },
  };
})();
