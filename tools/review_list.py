"""制度やガイドラインに左右される問題のうち、内容の確認が済んでいないもの・古くなったものを一覧にする。
  python3 tools/review_list.py            確認がまだ、または12か月より前の問題を出す
  python3 tools/review_list.py --months 6 期限を6か月にする
  python3 tools/review_list.py --csv out.csv  一覧をCSVに書き出す
確認が済んだ問題には、データに chk（例 "2026-11"）を書く。アプリでは解説の下に確認時期が出る。
どの問題が対象かは、問題文・選択肢・暗記ポイントの語句から毎回判定する（新しい問題も自動で対象になる）。
"""
import collections, csv, datetime, re, sys
from datalib import SUBJECTS, load

LAW = re.compile(
    r'医療法|医師法|感染症法|予防接種法|薬機法|[一-龥]{2,}(?:基本法|取締法|防止法|保護法|福祉法|保健法|救助法|安全法|保険法|移植法|救命士法|衛生法)'
    r'|定期接種|任意接種|[一二三四五1-5]類感染症|全数把握|定点把握|届け?出|出席停止|診療報酬|保険適用|保険収載|指定難病|小児慢性特定疾病'
    r'|医療費助成|介護保険|要介護|要支援|医療計画|災害拠点病院|DMAT|救急救命士|特定行為|措置入院|医療保護入院|一時保護|児童相談所|通告'
    r'|母子健康手帳|乳幼児健診|学校健診|新生児マススクリーニング|脳死判定|死亡診断書|死体検案|異状死|医療事故調査|承認され|適応が(?:追加|拡大|広が)')
GL = re.compile(r'ガイドライン|指針|改訂|20[0-2]\d年|診断基準|JRC|JATEC|JPTEC|SSCG|GINA|GOLD|KDIGO')
NAME = {'law': '制度・法律', 'gl': 'ガイドライン・基準'}


def kind(q):
    t = (q.get('stem') or '') + ' '.join(q.get('choices') or []) + (q.get('explanation') or '')
    return 'law' if LAW.search(t) else 'gl' if GL.search(t) else None


def months_ago(chk, today):
    y, m = int(chk[:4]), int(chk[5:7])
    return (today.year - y) * 12 + today.month - m


def main():
    limit = int(sys.argv[sys.argv.index('--months') + 1]) if '--months' in sys.argv else 12
    out = sys.argv[sys.argv.index('--csv') + 1] if '--csv' in sys.argv else None
    today = datetime.date.today()
    rows, C = [], collections.Counter()
    for s in SUBJECTS:
        for q in load(s)['raw']['questions']:
            k = kind(q)
            if not k:
                continue
            chk = q.get('chk')
            state = '未確認' if not chk else ('期限切れ' if months_ago(chk, today) > limit else '確認済み')
            C[(s, k, state)] += 1
            if state != '確認済み':
                rows.append((s, q['id'], NAME[k], state, chk or '', q.get('category', ''), q['stem'][:60]))
    print('科目     種類                 確認済み  期限切れ  未確認')
    for s in SUBJECTS:
        for k in ('law', 'gl'):
            print('%-8s %-18s %6d %8d %7d' % (s, NAME[k], C[(s, k, '確認済み')], C[(s, k, '期限切れ')], C[(s, k, '未確認')]))
    if out:
        with open(out, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['科目', '番号', '種類', '状態', '確認時期', '分野', '問題文'])
            w.writerows(rows)
        print('%d問を %s に書き出しました' % (len(rows), out))


if __name__ == '__main__':
    main()
