# Pre-render every unlocked tale into a single audio file (voice/tales/<id>.wav).
# Run any time; skips tales already baked. Re-run after adding tales.
import os, json, time, urllib.request
import torch

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(DIR)
OUT = os.path.join(DIR, "tales")
REFS = os.path.join(DIR, "refs")
os.makedirs(OUT, exist_ok=True)

CB_MOOD = {
    "plain":   (0.45, 0.50), "soft": (0.35, 0.38), "warm": (0.55, 0.45),
    "tense":   (0.60, 0.35), "grand": (0.55, 0.35), "excited": (0.85, 0.50),
    "afraid":  (0.70, 0.40),
}

def segments(text):
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request("http://127.0.0.1:7439/segments", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    import perth
    if getattr(perth, "PerthImplicitWatermarker", None) is None:
        class _NoWM:
            def apply_watermark(self, wav, sample_rate=None, **kw): return wav
        perth.PerthImplicitWatermarker = _NoWM
    from chatterbox.tts import ChatterboxTTS
    import torchaudio

    with open(os.path.join(ROOT, "tales.json"), encoding="utf-8") as f:
        tales = json.load(f)["tales"]
    todo = [t for t in tales if t.get("unlocked") and t.get("text")
            and not os.path.isfile(os.path.join(OUT, t["id"] + ".wav"))
            and not os.path.isfile(os.path.join(OUT, t["id"] + ".mp3"))]
    if not todo:
        print("nothing to bake"); return
    print(f"baking {len(todo)} tales ...", flush=True)

    m = ChatterboxTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")
    gap = torch.zeros(1, int(m.sr * 0.28))

    for t in todo:
        t0 = time.time()
        try:
            segs = segments(t["text"])
            parts = []
            for i, g in enumerate(segs):
                ex, cfg = CB_MOOD.get(g["mood"], CB_MOOD["plain"])
                ref = os.path.join(REFS, g["speaker"] + ".wav")
                kw = {"exaggeration": ex, "cfg_weight": cfg}
                if os.path.isfile(ref):
                    wav = m.generate(g["text"], audio_prompt_path=ref, **kw)
                else:
                    wav = m.generate(g["text"], **kw)
                parts.append(wav)
                parts.append(gap)
            audio = torch.cat(parts, dim=-1)
            tmp = os.path.join(OUT, t["id"] + ".part.wav")
            torchaudio.save(tmp, audio, m.sr, format="wav")
            os.replace(tmp, os.path.join(OUT, t["id"] + ".wav"))
            print(f"  {t['id']}: {audio.shape[-1]/m.sr/60:.1f} min in {time.time()-t0:.0f}s", flush=True)
        except Exception as e:
            print(f"  {t['id']} FAILED: {e}", flush=True)
    print("bake complete", flush=True)

if __name__ == "__main__":
    main()
