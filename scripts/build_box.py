"""Per-game player lines (box scores) for the date-range filter, one CSV per season."""
import json, glob, os, csv, datetime, collections
from fetch import load  # UTF-8 + repairs pssbl.com's double-encoded names
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW=os.path.join(ROOT,'raw'); OUT=os.path.join(ROOT,'build')
def i(x):
    try: return int(x or 0)
    except: return 0
meta={}   # gameId -> (season, date, playoff)
games={}  # gameId -> scoreline for the Players page game log (a game is listed in both teams' Games files)
for f in glob.glob(f'{RAW}/Games_*_20*.json'):
    y=int(f[-9:-5])
    for g in load(f):
        if g['outcome']!='finished': continue
        d=datetime.datetime.strptime(g['dateTime'],'%b %d %Y, %I:%M %p').date().isoformat()
        meta[g['gameId']]=(y,d,0 if g['playoffRound'] in ('0','',None) else 1)
        games[g['gameId']]={'gameId':g['gameId'],'Season':y,'Date':d,'PO':meta[g['gameId']][2],
            'home':g['homeId'],'away':g['awayId'],'homeName':g['homeName'].strip(),'awayName':g['awayName'].strip(),
            'homeDiv':g['homeDivision'],'awayDiv':g['awayDivision'],'hr':i(g['homeRuns']),'ar':i(g['awayRuns']),'Field':(g.get('fieldName') or '').strip()}
tdiv={}
for f in glob.glob(f'{RAW}/TeamNames_*.json'):
    y=int(f[-9:-5])
    for t in load(f): tdiv[(y,t['teamId'])]=(t['teamName'].strip(),t['divisionName'])
CUM={'b':set(),'p':set()}; CUM_BY={'b':collections.defaultdict(list),'p':collections.defaultdict(list)}
for kind,fn in (('b','batting'),('p','pitching')):
    for r in csv.DictReader(open(f'{OUT}/pssbl_{fn}.csv',encoding='utf-8')):
        k=(int(r['Season']),r['pid'],r['tid']); CUM[kind].add(k); CUM_BY[kind][(k[0],k[1])].append(k)
BC=['kind','Date','Season','gameId','PO','pid','Name','tid','ptid','Team','Division','GS','AB','R','H','2B','3B','HR','RBI','SB','CS','BB','SO','GDP','HBP','SH','SF','CI','Outs','W','L','SV','CG','ER','IBB','WP','Ord']
per=collections.defaultdict(list); missing=collections.Counter(); total=collections.Counter()
for gid,(y,d,po) in meta.items():
    total[y]+=1
    try:
        b=load(f'{RAW}/box/BattingStats_{gid}.json'); p=load(f'{RAW}/box/PitchingStats_{gid}.json')
    except Exception: b,p=[],[]
    if not b and not p: missing[y]+=1; continue
    agg={}
    for x in b:
        k=('b',x['playerId'],x['teamId'])
        r=agg.setdefault(k,collections.Counter())
        for a,c in [('ab','AB'),('r','R'),('h','H'),('d','2B'),('t','3B'),('hr','HR'),('rbi','RBI'),('sb','SB'),('cs','CS'),('bb','BB'),('so','SO'),('gdp','GDP'),('hbp','HBP'),('sh','SH'),('sf','SF'),('ci','CI')]: r[c]+=i(x.get(a))
        r['_n']=f"{x['firstName'].strip()} {x['lastName'].strip()}"
        o=i(x.get('battingOrder')); r['Ord']=min(r['Ord'] or o,o) if o else r['Ord']  # lineup slot; subs share it, listed after the starter
    for x in p:
        k=('p',x['playerId'],x['teamId'])
        r=agg.setdefault(k,collections.Counter())
        for a,c in [('outs','Outs'),('w','W'),('l','L'),('sv','SV'),('cg','CG'),('h','H'),('r','R'),('er','ER'),('hr','HR'),('ibb','IBB'),('bb','BB'),('so','SO'),('hbp','HBP'),('wp','WP')]: r[c]+=i(x.get(a))
        if x.get('pitchingOrder')=='1': r['GS']=1
        o=i(x.get('pitchingOrder')); r['Ord']=min(r['Ord'] or o,o) if o else r['Ord']
        r['_n']=f"{x['firstName'].strip()} {x['lastName'].strip()}"
    for (kind,pid,tid),r in agg.items():
        ptid=''
        if (y,pid,tid) not in CUM[kind]:
            div0=tdiv.get((y,tid),('',''))[1]
            alt=[t for (yy,pp,t) in CUM_BY[kind].get((y,pid),[]) if tdiv.get((y,t),('',''))[1]==div0]
            if len(alt)==1: ptid,tid=tid,alt[0]
        team,div=tdiv.get((y,tid),('',''))
        row={'kind':'bat' if kind=='b' else 'pit','Date':d,'Season':y,'gameId':gid,'PO':po,'pid':pid,'Name':r['_n'],'tid':tid,'ptid':ptid,'Team':team,'Division':div}
        for c in BC[11:]:
            v=r.get(c,0)
            row[c]=v if v else ''
        if kind=='b':
            for c in ['GS','Outs','W','L','SV','CG','ER','IBB','WP']: row[c]=''
        per[y].append(row)
for y in sorted(per):
    rows=sorted(per[y],key=lambda r:(r['Date'],r['gameId']))
    with open(f'{OUT}/pssbl_box_{y}.csv','w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,BC); w.writeheader(); w.writerows(rows)
    print(y,len(rows),'games',total[y],'missing',missing[y],f"{os.path.getsize(f'{OUT}/pssbl_box_{y}.csv')/1e6:.2f}MB")
json.dump({y:{'games':total[y],'missing':missing[y]} for y in total},open(f'{OUT}/box_coverage.json','w',encoding='utf-8'))
with open(f'{OUT}/pssbl_games.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,['gameId','Season','Date','PO','home','away','homeName','awayName','homeDiv','awayDiv','hr','ar','Field'])
    w.writeheader(); w.writerows(sorted(games.values(),key=lambda g:(g['Date'],int(g['gameId']))))
print('games',len(games))
