// === audio.api.js ===
(function(){
  const ctx = new (window.AudioContext || window.webkitAudioContext || function(){})();
  const buffers = new Map();
  const muted = { music:false, sfx:false };

  function load(url){
    if (!ctx || buffers.has(url)) return Promise.resolve(buffers.get(url));
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => { buffers.set(url, buffer); return buffer; })
      .catch(()=>null);
  }

  function playBuffer(buffer, opts={}){
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 0.6;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }

  const AudioAPI = {
    toggleMute(type){
      if (!type || !(type in muted)) return;
      muted[type] = !muted[type];
    },
    playMusic(url){
      if (muted.music || !url) return;
      load(url).then(buf => playBuffer(buf, { volume:0.4, loop:true }));
    },
    playSfx(url){
      if (muted.sfx || !url) return;
      load(url).then(buf => playBuffer(buf, { volume:0.7 }));
    }
  };

  window.AudioAPI = AudioAPI;
})();
