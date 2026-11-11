# Downloads CC0 recordings (OpenGameArt + Freesound previews) and cuts them into game-ready loops and one-shots.
# Usage: python scripts/prep-audio.py   (needs ffmpeg on PATH)
import os, subprocess, urllib.request, wave, array, math
SRC, OUT = 'assets-src/audio', 'public/assets/audio'
os.makedirs(SRC, exist_ok=True); os.makedirs(OUT, exist_ok=True)

def get(url, name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p) or os.path.getsize(p) == 0:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        open(p, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    return p
def ff(args):
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + args, check=True)
def pcm(path, sr=22050):
    tmp = path + '.tmp.wav'; ff(['-i', path, '-ac', '1', '-ar', str(sr), tmp])
    w = wave.open(tmp); a = array.array('h'); a.frombytes(w.readframes(w.getnframes())); w.close(); os.remove(tmp); return a, sr
def steady(path, length, hop=0.25):
    """start time of the loudest, most even window of `length` seconds"""
    a, sr = pcm(path); n = int(hop * sr)
    rms = [math.sqrt(sum(x * x for x in a[i:i + n]) / n) for i in range(0, len(a) - n, n)]
    k = int(length / hop); best, bi = -1, 0
    for i in range(0, len(rms) - k):
        w = rms[i:i + k]; score = min(w) * 0.7 + (sum(w) / k) * 0.3
        if score > best: best, bi = score, i
    return bi * hop
def loop(src, dst, start, length, xf=0.35, sr=22050, gain=1.0, extra=''):
    """seamless loop: the tail is cross-faded into the head"""
    f = (f"[0]atrim={start}:{start + length},asetpts=N/SR/TB,aresample={sr},asplit[a][b];[a]atrim=0:{xf},asetpts=N/SR/TB[head];"
         f"[b]atrim={xf},asetpts=N/SR/TB[body];[body][head]acrossfade=d={xf}:c1=tri:c2=tri,loudnorm=I=-18:TP=-2,volume={gain}{extra}")
    ff(['-i', src, '-filter_complex', f, '-ac', '1', '-ar', str(sr)] + (['-c:a', 'libmp3lame', '-b:a', '80k'] if dst.endswith('.mp3') else ['-c:a', 'pcm_s16le']) + [os.path.join(OUT, dst)])
def shot(src, dst, start, length, gain=1.0):
    ff(['-i', src, '-ss', str(start), '-t', str(length), '-af', f'afade=t=out:st={max(0, length - 0.15)}:d=0.15,loudnorm=I=-16:TP=-1.5,volume={gain}', '-ac', '1', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '96k', os.path.join(OUT, dst)])
def onset(path, thresh=0.12):
    a, sr = pcm(path); peak = max(abs(x) for x in a) or 1
    for i, x in enumerate(a):
        if abs(x) > peak * thresh: return max(0, i / sr - 0.02)
    return 0

FS = 'https://cdn.freesound.org/previews/'
# engine: six short rpm loops (CC0, OpenGameArt "racing car engine sound loops" by domasx2)
for i, n in enumerate(['loop_0', 'loop_1_0', 'loop_2_0', 'loop_3_0', 'loop_4_0', 'loop_5_0']):
    p = get(f'https://opengameart.org/sites/default/files/{n}.wav', f'engine_{i}.wav')
    ff(['-i', p, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', os.path.join(OUT, f'engine_{i}.wav')])
p = get(FS + '71/71736_995351-hq.mp3', 'skid.mp3');        loop(p, 'skid.wav', steady(p, 3.0), 3.0)
p = get(FS + '251/251662_3719168-hq.mp3', 'gravel.mp3');   loop(p, 'gravel.wav', steady(p, 4.0), 4.0)
p = get(FS + '444/444921_8439257-hq.mp3', 'wind.mp3');     loop(p, 'wind.wav', steady(p, 6.0), 6.0, 0.8)
p = get(FS + '321/321885_4458028-hq.mp3', 'rain.mp3');     loop(p, 'rain.mp3', steady(p, 14.0), 14.0, 1.0)
p = get(FS + '566/566207_12728338-hq.mp3', 'birds.mp3');   loop(p, 'birds.mp3', 4, 40.0, 1.5)
p = get(FS + '521/521843_129727-hq.mp3', 'crickets.mp3');  loop(p, 'crickets.mp3', 0.5, 8.5, 0.8)
p = get(FS + '237/237375_1502374-hq.mp3', 'crash1.mp3');   shot(p, 'crash_big.mp3', onset(p), 2.6)
p = get(FS + '321/321482_5485024-hq.mp3', 'crash2.mp3');   shot(p, 'crash_metal.mp3', onset(p), 1.4)
p = get(FS + '340/340539_4959511-hq.mp3', 'crash3.mp3');   shot(p, 'crash_light.mp3', onset(p), 0.4)
p = get(FS + '659/659544_13241413-hq.mp3', 'turbo.mp3');   shot(p, 'turbo.mp3', 0, 5.2)
print('audio ready')
