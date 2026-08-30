/* Cut candidate voice seeds for Nell straight from the edge voices,
   bypassing the speaker map so each candidate gets its own settings. */
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');

const REFS = path.join(__dirname, 'refs');
const SEED = "Oh - hey, I saved you a seat. Sit, sit. I didn't save it save it, it's just, the owls like you, and nobody sits with the owls, which is mad, honestly. Their loss. Do you want to see something brilliant before the trolley comes? It's about the barn owl. He pretends to be asleep when the cats go past, and he is fooling nobody, and he keeps doing it.";

const CANDIDATES = {
  aud_a: { voice: 'en-GB-LibbyNeural',  rate: '+4%',  pitch: '+10Hz' }, // same girl, woken up
  aud_b: { voice: 'en-GB-MaisieNeural', rate: '+8%',  pitch: '+2Hz'  }, // genuinely a child
  aud_c: { voice: 'en-GB-SoniaNeural',  rate: '+6%',  pitch: '+25Hz' }, // bright, quick, pitched young
};

async function main() {
  for (const [id, c] of Object.entries(CANDIDATES)) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(c.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      let st = await tts.toStream(SEED, { rate: c.rate, pitch: c.pitch });
      if (st && st.audioStream) st = st.audioStream;
      const out = fs.createWriteStream(path.join(REFS, id + '.mp3'));
      await new Promise((res, rej) => { st.pipe(out); out.on('finish', res); st.on('error', rej); });
      console.log(id, 'seed ok (' + c.voice + ')');
    } catch (e) { console.log(id, 'FAILED:', e.message); }
  }
}
main();
