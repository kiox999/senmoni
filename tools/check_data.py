"""問題データの検査。コミット前と、GitHub 上でプルリクエストごとに実行する。
  python3 tools/check_data.py        誤りがあれば一覧を出して終了コード1
  python3 tools/check_data.py -v     注意（誤りではないが見直し候補）も一覧で出す
誤り = 直すまでマージしない。注意 = 件数だけ表示。
"""
import collections, re, sys
from datalib import SUBJECTS, load, encyc_map, deep_name

LETTERS = 'abcde'
VERB = re.compile(r'(る|い|た|だ|す|く|ぶ|つ|う|む|ぐ|ぬ)$')
PAREN_END = re.compile(r'[（(][^（）()]*[）)]$')
COUNT = re.compile(r'([2-5２-５二三四五])つ選べ')
FORMULA = re.compile(r'[×÷−＋+\-/／]|[0-9０-９]')
NUM = {'２': 2, '３': 3, '４': 4, '５': 5, '二': 2, '三': 3, '四': 4, '五': 5}


def noun_ended(sentence):
    t = sentence.strip().rstrip('。')
    while PAREN_END.search(t):
        t = PAREN_END.sub('', t)
    return bool(t) and not VERB.search(t)


def check_question(q, emap):
    err, warn = [], []
    ch, cor = q.get('choices') or [], q.get('correct') or []
    if not q.get('stem'):
        err.append('問題文がない')
    if len(ch) != 5:
        err.append('選択肢が5つでない')
    if len(set(ch)) != len(ch):
        err.append('同じ選択肢が2つある')
    if not cor or any(c not in LETTERS[:len(ch)] for c in cor) or len(set(cor)) != len(cor):
        err.append('正解の指定がおかしい')
        return err, warn
    m = COUNT.search(q.get('stem') or '')
    want = (NUM.get(m.group(1)) or int(m.group(1))) if m else 1
    if want != len(cor):
        err.append('「%dつ選べ」と正解の数(%d)が合わない' % (want, len(cor)))
    for k in (q.get('notes') or {}):
        if k not in LETTERS[:len(ch)]:
            err.append('選択肢別の解説の記号がおかしい')
    for k in (q.get('kinki') or []):
        if k in cor:
            err.append('正解の選択肢に禁忌マークが付いている')
    ex = q.get('explanation') or ''
    if not ex:
        err.append('暗記ポイントがない')
    sents = [s for s in re.split(r'(?<=。)', ex) if s.strip()]
    # 「→」は3つ以上を順に並べるとき（A→B→C）だけ可。「＝」は計算式の中だけ可。
    if any(s.count('→') == 1 for s in sents):
        err.append('暗記ポイントで「→」を「だから」「すると」の代わりに使っている')
    if any(not (FORMULA.search(m.group(1)) or FORMULA.search(m.group(2))) for m in re.finditer(r'(.{0,12})＝(.{0,12})', ex)):
        err.append('暗記ポイントで「＝」を「は」「である」の代わりに使っている')
    if any(noun_ended(s) for s in sents):
        err.append('暗記ポイントに体言止めの文がある')
    if q.get('dd') and q.get('deepdive'):
        err.append('dd と deepdive の両方がある')
    name = deep_name(q)
    if not q.get('dd') and not q.get('deepdive'):
        err.append('関連知識がない')
    elif q.get('dd') and name not in emap:
        err.append('関連知識の項目「%s」が事典にない' % name)
    # ここから注意
    if any(re.search(r'のみ|(?<!できる)だけ(?!で)', c) for c in ch):
        err.append('選択肢に「のみ」「だけ」がある')
    ci = [LETTERS.index(c) for c in cor]
    inc = [j for j in range(len(ch)) if j not in ci]
    if inc and len(ch) == 5:
        L = [len(c) for c in ch]
        mo = max(L[j] for j in inc)
        lo = min(L[i] for i in ci)
        if lo >= 1.4 * mo and lo - mo >= 6:
            warn.append('正解だけ長い')
    for i in ci:
        c = re.sub(r'[（(].*?[）)]', '', ch[i]).strip()
        if len(c) >= 5 and c in (q.get('stem') or ''):
            warn.append('正解の語句が問題文にある')
    if len(ex) > 330:
        warn.append('暗記ポイントが長い')
    return err, warn


def main():
    verbose = '-v' in sys.argv
    E, W = [], collections.Counter()
    WL = []
    for s in SUBJECTS:
        d = load(s)
        qs, emap = d['raw']['questions'], encyc_map(d)
        ids = collections.Counter(q.get('id') for q in qs)
        for i, n in ids.items():
            if n > 1:
                E.append((s, i, '問題番号が重複'))
        byid = {q['id']: q for q in qs}
        for q in qs:
            err, warn = check_question(q, emap)
            E += [(s, q.get('id'), x) for x in err]
            for x in warn:
                W[x] += 1
                WL.append((s, q.get('id'), x))
        names = collections.Counter(e['n'] for e in d['raw']['encyc'])
        for n, c in names.items():
            if c > 1:
                E.append((s, '-', '事典の項目名「%s」が重複' % n))
        for e in d['raw']['encyc']:
            if not e.get('b'):
                E.append((s, '-', '事典「%s」の本文がない' % e['n']))
            for i in e.get('q') or []:
                if i not in byid:
                    E.append((s, i, '事典「%s」が存在しない問題を指している' % e['n']))
                elif deep_name(byid[i]) != e['n']:
                    W['事典の関連問題と、問題側の関連知識が食い違う'] += 1
                    WL.append((s, i, '事典「%s」の関連問題だが、関連知識は別項目' % e['n']))
        print('%s: %d問 / 事典 %d項目' % (s, len(qs), len(d['raw']['encyc'])))
    if W:
        print('注意:')
        for k, v in W.most_common():
            print('  %5d件  %s' % (v, k))
        if verbose:
            for s, i, x in WL:
                print('    %s %s  %s' % (s, i, x))
    if E:
        print('誤り %d件:' % len(E))
        for s, i, x in E[:200]:
            print('  %s %s  %s' % (s, i, x))
        return 1
    print('誤り 0件')
    return 0


if __name__ == '__main__':
    sys.exit(main())
