# Build per-character voice reference clips.
# Uses the existing Edge voices as seed timbres (distinct per character),
# saved as wav for Chatterbox to clone. Drop your own <speaker>.wav in refs/ to recast anyone.
import os, json, urllib.request, sys
import librosa, soundfile as sf

DIR = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(DIR, "refs")
os.makedirs(REFS, exist_ok=True)
NODE = "http://127.0.0.1:7439/tts"

# neutral, characterful seed lines (~10s each)
SEEDS = {
    "narrator":  "[narrator] Once, in a castle older than the counting of it, there lived a year that nobody who survived it ever forgot. This is the shape of my voice when I tell you true things by the fire, slowly, so that you keep them.",
    "mum":       "[mum] Right then, love. Coat on, chin up, and mind you write when you say you will. I have raised two children and a husband, and I know a promise when I hear one. Off you go, and come back taller.",
    "ollivander":"[ollivander] Curious. Very curious indeed. I remember every wand I have ever sold, young man, every single one, and the hand that took it, and I do not say that to boast. Sit still a moment and let me look at you properly.",
    "vekk":      "[vekk] Vault nine hundred and forty. They always want all eighty. Sign here, and here, and do not ask me to smile about it. Mind your elbows in the cart, and mind your promises in this bank.",
    "posy":      "[posy] Oh you will not BELIEVE what I found out at breakfast, I have been saving it all morning and it has been agony! Right, sit down, this is question ninety-two territory, and I am not even slightly exaggerating this time!",
    "nell":      "[nell] It's alright, you know. You don't have to say anything. I'm quite good at sitting quietly, and the owls like it better anyway. Some things are easier to say after a while, when nobody's looking at you.",
    "idris":     "[idris] Technically that corridor is four feet longer at night, which nobody in my family thought was interesting for two hundred years. I measured it myself, twice, in the dark. The measurements are in my notebook. They do not agree, which is the interesting part.",
    "rooke":     "[rooke] Eleven generations of my family have walked these particular corridors, and I intend to be remembered as clearly as any of them. You may consider that a warning or an introduction. In my experience the useful people treat it as both.",
    "fen":       "[fen] Sorry! Sorry, I didn't see the step, there's always a step, isn't there. I'm fine though, honestly, I'm completely fine! Are you going down to breakfast? I'll walk with you, I promise not to fall on anything important.",
    "dumbledore":"[dumbledore] Do sit down. The chair is friendlier than it looks, which is true of a surprising number of things in this castle. I find the beginning is generally the best place to start, and lemon drops rarely hurt the process.",
    "whisp":     "[whisp] Three rules. Books return in the state they left. The Restricted Section is not a dare. And if ever you hear pages turning in a place with no books, you come and tell me, and no one else. Quietly now. What do you need?",
    "burke":     "[burke] Eleven years I have stood at fences in the cold, child, and I have learned patience the way stones learn rivers. I am, whatever you may have heard, a fair man. Old Burke is always fair. Choose carefully.",
    "sedge":     "[sedge] I remember being found. I remember that much. You learn to keep your hands steady, as a prefect - people watch your hands to know whether to be frightened. So I keep them steady, and I keep reading, and I notice rather more than I say.",
    "lady":      "[lady] Four hundred years, and the moonlight still lands where my shadow ought to be. I have watched every clever child this castle ever swallowed, and I am telling you, slowly, because it matters: knowledge hoarded is knowledge starved, and a starved thing bites.",
    "peeves":    "[peeves] Ohhh, ickle firsties, lost little firsties, Peevesy knows the way, Peevesy ALWAYS knows the way! Shall I tell? Shall I? It goes down, down, DOWN - or possibly up! Wouldn't THAT be funny!",
    "man":       "[man] Steady on, steady on. I've carried heavier than you up three flights of stairs with the smoke coming under the door, and I'll tell you what I tell the young lads: slow is smooth, and smooth is fast, and everybody goes home.",
    "woman":     "[woman] Come along then, dears, all of you, this way. Mind the step, keep together, and if anyone's lost their toad AGAIN it can be collected from the front desk after supper. No pushing. There's plenty of everything.",
    "boy":       "[boy] I practised all summer, honestly, all summer! Watch, I've nearly got it, it only went wrong the once and the eyebrows grew back completely. Watch, watch - okay that was not supposed to happen, but WATCH.",
    "girl":      "[girl] That's not fair and you KNOW it isn't. I'm telling. Well - I'm not telling, telling is for babies, but I'm definitely writing it down, and when I'm big it's going in my book, and THEN you'll be sorry.",
}

def make(speaker, text):
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(NODE, data=body, headers={"Content-Type": "application/json"})
    mp3 = os.path.join(REFS, speaker + ".mp3")
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    with open(mp3, "wb") as f:
        f.write(data)
    y, sr = librosa.load(mp3, sr=24000, mono=True)
    wav = os.path.join(REFS, speaker + ".wav")
    sf.write(wav, y, sr)
    os.remove(mp3)
    print(f"{speaker}: {len(y)/sr:.1f}s")

if __name__ == "__main__":
    only = sys.argv[1:] or list(SEEDS)
    for sp in only:
        if os.path.isfile(os.path.join(REFS, sp + ".wav")):
            print(sp, "(exists, skipped)"); continue
        try: make(sp, SEEDS[sp])
        except Exception as e: print(sp, "FAILED:", e)
