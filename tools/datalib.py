"""問題データ(data/*.js)の読み書き。tools/ の各スクリプトが使う。"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUBJECTS = ['naika', 'kyukyu', 'shouni']
DD = re.compile(r'【(.+?)】(.*)', re.S)


def path(subj):
    return os.path.join(ROOT, 'data', subj + '.js')


def read(subj):
    """(前置き, データ, 後置き) を返す。前置きは window.BOARD_DATA= の部分。"""
    t = open(path(subj), encoding='utf-8').read()
    i = t.index('{')
    d, end = json.JSONDecoder().raw_decode(t[i:])
    return t[:i], d, t[i + end:]


def write(subj, pre, d, tail):
    with open(path(subj), 'w', encoding='utf-8') as f:
        f.write(pre + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + tail)


def load(subj):
    return read(subj)[1]


def encyc_map(d):
    return {e['n']: e for e in d['raw']['encyc']}


def deep_name(q):
    """その問題の「関連知識」が指す事典項目名。なければ None。"""
    if q.get('dd'):
        return q['dd']
    m = DD.match(q.get('deepdive') or '')
    return m.group(1) if m else None


def deep_text(q, emap):
    """アプリが表示する関連知識の全文（dd 参照は事典本文に展開する）。"""
    if q.get('deepdive'):
        return q['deepdive']
    if q.get('dd') and q['dd'] in emap:
        return '【' + q['dd'] + '】' + emap[q['dd']]['b']
    return ''
