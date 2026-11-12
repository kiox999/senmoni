"""関連知識(deepdive)が事典本文の写しになっている問題を、項目名の参照(dd)に置き換える。
事典と食い違う独自の本文を持つ問題はそのまま残す。何度実行してもよい。"""
import sys
from datalib import SUBJECTS, read, write, encyc_map, DD

for s in SUBJECTS:
    pre, d, tail = read(s)
    em = encyc_map(d)
    before = len(open(__import__('datalib').path(s), 'rb').read())
    n = keep = 0
    for q in d['raw']['questions']:
        dd = q.get('deepdive')
        if not dd:
            continue
        m = DD.match(dd)
        if m and m.group(1) in em and em[m.group(1)]['b'] == m.group(2):
            del q['deepdive']
            q['dd'] = m.group(1)
            n += 1
        else:
            keep += 1
    write(s, pre, d, tail)
    after = len(open(__import__('datalib').path(s), 'rb').read())
    print(f'{s}: 参照に置換 {n}問 / 独自本文のまま {keep}問 / {before/1e6:.1f}MB → {after/1e6:.1f}MB')
