# Lists CC0 Freesound results (id, duration, title, preview URL) for a query. Dev helper for sourcing audio.
import sys, re, urllib.request, urllib.parse, html
q = sys.argv[1]
url = 'https://freesound.org/search/?' + urllib.parse.urlencode({'q': q, 'f': 'license:"Creative Commons 0"' + (' ' + sys.argv[2] if len(sys.argv) > 2 else ''), 's': 'Rating (highest first)'})
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
page = urllib.request.urlopen(req, timeout=30).read().decode('utf8', 'ignore')
for m in re.finditer(r'data-sound-id="(\d+)"(.*?)data-mp3="([^"]+)"(.*?)data-duration="([^"]+)"', page, re.S):
    sid, _, mp3, _, dur = m.groups()
    t = re.search(r'data-title="([^"]*)"', m.group(0))
    print(sid, '%.1fs' % float(dur), html.unescape(t.group(1)) if t else '', mp3)
