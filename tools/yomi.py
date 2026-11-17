"""事典の項目名から並べ替え用の読み（ひらがな、k）をつけて、データに書き込む。
アプリは k で50音順に並べる。英字・数字で始まる項目（Crohn病、2型糖尿病など）は k をつけず、
アプリ側で「欧文」としてまとめて先頭に並べる。

  pip install fugashi unidic-lite jaconv
  python3 tools/yomi.py            疾患事典（data/*.js）と薬剤・用語（data/ref.js）に k を書き込む
  python3 tools/yomi.py --check    書き込まずに、読みの一覧を表示する

辞書が医学用語を読み違えるものは READ_FIX に足す（見出しの先頭の読みが並び順を決める）。
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datalib  # noqa: E402

# 辞書が一般語の読みをしてしまう医学用語。前から順に置き換えてから読みをつける
READ_FIX = [
    ('筋無力', 'きんむりょく'), ('筋', 'きん'), ('咽後', 'いんご'), ('喉頭', 'こうとう'),
    ('偽', 'ぎ'), ('憤怒', 'ふんぬ'), ('塩喪失', 'えんそうしつ'), ('苺状', 'いちごじょう'),
    ('左冠動脈', 'さかんどうみゃく'), ('もやもや病', 'もやもやびょう'),
]

_tagger = None


def reading(name):
    global _tagger
    import jaconv
    if _tagger is None:
        import fugashi
        _tagger = fugashi.Tagger()
    s = re.split(r'[（(]', name)[0] or name
    for a, b in READ_FIX:
        s = s.replace(a, b)
    out = ''
    for m in _tagger(s):
        k = getattr(m.feature, 'kana', None)
        out += m.surface if (not k or k == '*') else k
    out = jaconv.kata2hira(out)
    return re.sub(r'[\s・･/／、,.\-－―]', '', out)


def latin_head(name):
    return bool(re.match(r'[A-Za-z0-9０-９Ａ-Ｚａ-ｚα-ωΑ-Ωβ]', name))


def key_for(e):
    """y（カタカナの読み）があっても、英字で始まる名前は欧文として扱う。"""
    if latin_head(e['n']):
        return None
    return reading(e['n'])


def main():
    check = '--check' in sys.argv
    changed = 0
    for subj in datalib.SUBJECTS:
        pre, d, tail = datalib.read(subj)
        for e in d['raw']['encyc']:
            k = key_for(e)
            if check:
                print(subj, e['n'], '→', k or '（欧文）')
            if k:
                if e.get('k') != k:
                    e['k'] = k; changed += 1
            elif 'k' in e:
                del e['k']; changed += 1
        if not check:
            datalib.write(subj, pre, d, tail)
    ref = os.path.join(datalib.ROOT, 'data', 'ref.js')
    t = open(ref, encoding='utf-8').read()
    i = t.index('window.BOARD_REF = ') + len('window.BOARD_REF = ')
    head = t[:i]
    obj = json.loads(t[i:].rstrip().rstrip(';'))
    for kind in ('drugs', 'terms'):
        for e in obj[kind]:
            k = key_for(e)
            if check:
                print(kind, e['n'], '→', k or '（欧文）')
            if k:
                if e.get('k') != k:
                    e['k'] = k; changed += 1
            elif 'k' in e:
                del e['k']; changed += 1
    if not check:
        lines = lambda a: ',\n'.join(json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in a)
        body = '{\n"groups": ' + json.dumps(obj.get('groups', []), ensure_ascii=False) + ',\n"drugs": [\n' + lines(obj['drugs']) + '\n],\n"terms": [\n' + lines(obj['terms']) + '\n]\n};\n'
        open(ref, 'w', encoding='utf-8').write(head + body)
        print('読みを更新：', changed, '件')


if __name__ == '__main__':
    main()
