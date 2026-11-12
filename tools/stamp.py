"""配信ファイルの中身から版番号を決め、sw.js のキャッシュ名と index.html の BOARD_BUILD に書き込む。
中身が変われば版番号も変わるので、手で数字を上げる必要はない。
  python3 tools/stamp.py          書き込む
  python3 tools/stamp.py --check  書き込まずに、いまの版番号が中身と合っているかだけ調べる
"""
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = re.compile(r"var CACHE = '([^']*)';")
BUILD = re.compile(r'window\.BOARD_BUILD = "([^"]*)";')
FILES = re.compile(r"var FILES = \[(.*?)\];", re.S)


def rd(name):
    return open(os.path.join(ROOT, name), encoding='utf-8').read()


def compute():
    sw, html = rd('sw.js'), rd('index.html')
    names = [x for x in re.findall(r"'([^']+)'", FILES.search(sw).group(1)) if x not in ('./', 'index.html')]
    h = hashlib.sha256()
    h.update(SW.sub('', sw).encode())
    h.update(BUILD.sub('', html).encode())
    for n in sorted(names):
        h.update(n.encode())
        h.update(open(os.path.join(ROOT, n), 'rb').read())
    return h.hexdigest()[:12]


def current():
    return SW.search(rd('sw.js')).group(1), BUILD.search(rd('index.html')).group(1)


def main():
    v = compute()
    want = ('board-' + v, v)
    if '--check' in sys.argv:
        if current() != want:
            print('版番号が中身と合っていません。python3 tools/stamp.py を実行してからコミットしてください。')
            print('  いま:', current(), ' 正:', want)
            return 1
        print('版番号 OK:', v)
        return 0
    for name, pat, rep in (('sw.js', SW, "var CACHE = '%s';" % want[0]), ('index.html', BUILD, 'window.BOARD_BUILD = "%s";' % v)):
        t = rd(name)
        t2 = pat.sub(lambda m: rep, t, count=1)
        if t2 != t:
            open(os.path.join(ROOT, name), 'w', encoding='utf-8').write(t2)
    print('版番号:', v)
    return 0


if __name__ == '__main__':
    sys.exit(main())
