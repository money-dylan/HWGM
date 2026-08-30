"""Transcode tale recordings to MP3 for shipping: python voice/tomp3.py <out_dir> <wav> [<wav>...]
Uses libsndfile (via soundfile), no ffmpeg needed. Prints one line per file."""
import sys, os, soundfile as sf
args = sys.argv[1:]; level = 0.4
if args and args[0] == '--level': level = float(args[1]); args = args[2:]
out = args[0]; os.makedirs(out, exist_ok=True)
for w in args[1:]:
    data, sr = sf.read(w)
    dst = os.path.join(out, os.path.splitext(os.path.basename(w))[0] + '.mp3')
    sf.write(dst, data, sr, format='MP3', compression_level=level)   # 0.4 ~ speech + quiet music; 0.5 for the soundtrack
    print(dst, os.path.getsize(w) // 1024, '->', os.path.getsize(dst) // 1024, 'KB')
