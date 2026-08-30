# The Hollow Ledger — local expressive voice engine (Chatterbox TTS)
# POST /synth {text, speaker, exaggeration, cfg} -> audio/wav
import io, os, sys, threading
from flask import Flask, request, jsonify, Response

app = Flask(__name__)
DIR = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(DIR, "refs")

model = None
model_lock = threading.Lock()

def get_model():
    global model
    with model_lock:
        if model is None:
            import torch
            import perth
            if getattr(perth, "PerthImplicitWatermarker", None) is None:
                class _NoWatermark:
                    def apply_watermark(self, wav, sample_rate=None, **kw):
                        return wav
                perth.PerthImplicitWatermarker = _NoWatermark
                print("[voice] perth watermarker unavailable - using passthrough", flush=True)
            from chatterbox.tts import ChatterboxTTS
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[voice] loading Chatterbox on {device} ...", flush=True)
            model = ChatterboxTTS.from_pretrained(device=device)
            print("[voice] model ready", flush=True)
    return model

def ref_for(speaker):
    p = os.path.join(REFS, f"{speaker}.wav")
    return p if os.path.isfile(p) else None

@app.get("/health")
def health():
    ok = model is not None
    return jsonify({"ready": ok})

@app.post("/synth")
def synth():
    try:
        j = request.get_json(force=True)
        text = str(j.get("text", ""))[:1200]
        if not text.strip():
            return ("empty", 400)
        speaker = str(j.get("speaker", "narrator"))
        exaggeration = float(j.get("exaggeration", 0.5))
        cfg = float(j.get("cfg", 0.5))
        m = get_model()
        import torchaudio, torch
        kwargs = {"exaggeration": exaggeration, "cfg_weight": cfg}
        ref = ref_for(speaker)
        if ref:
            wav = m.generate(text, audio_prompt_path=ref, **kwargs)
        else:
            wav = m.generate(text, **kwargs)
        buf = io.BytesIO()
        torchaudio.save(buf, wav, m.sr, format="wav")
        return Response(buf.getvalue(), mimetype="audio/wav")
    except Exception as e:
        print("[voice] error:", e, flush=True)
        return (str(e), 500)

if __name__ == "__main__":
    # warm the model at startup so first request is fast
    threading.Thread(target=get_model, daemon=True).start()
    app.run(host="127.0.0.1", port=7440, threaded=True)
