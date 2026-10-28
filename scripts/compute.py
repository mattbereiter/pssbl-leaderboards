"""Build FanGraphs-style tables from raw PSSBL API dumps.

Each division-season is its own league context (like AL/NL), mirroring the
method already used in Matt's PSSBL Tracker app (FanGraphs linear weights,
wOBA scale 1.20, division-specific FIP constant).
"""
import json, glob, os, collections, math, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')      # pssbl.com API cache (scripts/fetch.py fills it)
OUT = os.path.join(ROOT, 'build')    # computed tables, before they're copied into public/data
os.makedirs(OUT, exist_ok=True)

W = dict(BB=.69, HBP=.72, S=.89, D=1.27, T=1.62, HR=2.10)
WOBA_SCALE = 1.20
QUAL_PA_PER_G = 2.0
QUAL_IP_PER_G = 0.5
MATT = '8048'

def i(x):
    try: return int(x or 0)
    except: return 0

def r(x, n):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))): return None
    return int(round(x)) if n == 0 else round(x, n)

def div0(a, b): return a / b if b else None

def ipnote(outs): return outs // 3 + (outs % 3) / 10


# ---- which team each player actually played for, from box scores ----
# pssbl.com's season-totals feed gives one line per player per division and its team label is
# unreliable for players who also filled in for another team (it can name the fill-in team).
# The box scores record the team for every game, so each line is labelled with the team the
# player appeared for most (ties: the most recent appearance). Stats themselves are untouched.
_tdiv = {}
for f in glob.glob(f'{RAW}/TeamNames_*.json'):
    for t in json.load(open(f)): _tdiv[(int(f[-9:-5]), t['teamId'])] = (t['teamName'].strip(), t['divisionName'])
_when = {}
for f in glob.glob(f'{RAW}/Games_*_20*.json'):
    for g in json.load(open(f)):
        if g['outcome'] == 'finished':
            _when[g['gameId']] = (int(f[-9:-5]), datetime.datetime.strptime(g['dateTime'], '%b %d %Y, %I:%M %p'))
_apps = collections.defaultdict(lambda: collections.defaultdict(list))
for gid, (y, dt) in _when.items():
    for kind, typ in (('b', 'BattingStats'), ('p', 'PitchingStats')):
        try: rows = json.load(open(f'{RAW}/box/{typ}_{gid}.json'))
        except Exception: continue
        for x in {(z['playerId'], z['teamId']) for z in rows}:
            _apps[(kind, y, x[0], _tdiv.get((y, x[1]), ('', ''))[1])][x[1]].append(dt)
RELABELED = collections.Counter()
def main_team(kind, y, d, rows):
    """Relabel each single-line player with the team he played for most in this division."""
    per = collections.Counter(x['playerId'] for x in rows)
    tg = {x['teamId']: x['teamGames'] for x in rows}
    out = []
    for x in rows:
        g = _apps.get((kind, y, x['playerId'], d))
        if g and per[x['playerId']] == 1:
            best = max(g, key=lambda t: (len(g[t]), max(g[t])))
            if best != x['teamId'] and (y, best) in _tdiv:
                x = dict(x, teamId=best, teamName=_tdiv[(y, best)][0], teamGames=tg.get(best, x['teamGames']))
                RELABELED[(kind, y)] += 1
        out.append(x)
    return out

seasons = sorted({int(f.split('_')[-1][:4]) for f in glob.glob(f'{RAW}/CumulativeBatting_*_*.json')})
bat_rows, pit_rows, guts, standings = [], [], [], []

for y in seasons:
    for fb in sorted(glob.glob(f'{RAW}/CumulativeBatting_*_{y}.json')):
        d = fb.split('_')[-2]
        B = main_team('b', y, d, json.load(open(fb)))
        P = main_team('p', y, d, json.load(open(f'{RAW}/CumulativePitching_{d}_{y}.json')))
        G = json.load(open(f'{RAW}/Games_{d}_{y}.json'))
        if not B and not P: continue

        # ---- batting base
        bs = []
        for x in B:
            ab, h, d2, t3, hr = i(x['ab']), i(x['h']), i(x['d']), i(x['t']), i(x['hr'])
            bb, ibb, hbp, sf, sh, ci = i(x['bb']), i(x['ibb']), i(x['hbp']), i(x['sf']), i(x['sh']), i(x['ci'])
            s1 = h - d2 - t3 - hr
            pa = ab + bb + hbp + sf + sh + ci
            if pa == 0 and i(x['g']) == 0: continue
            bs.append(dict(x=x, ab=ab, h=h, s1=s1, d2=d2, t3=t3, hr=hr, bb=bb, ibb=ibb, hbp=hbp, sf=sf, sh=sh,
                           pa=pa, so=i(x['so']), sb=i(x['sb']), cs=i(x['cs']), r=i(x['r']), rbi=i(x['rbi']),
                           gdp=i(x['gdp']), g=i(x['g'])))
        def wnum(s): return W['BB']*(s['bb']-s['ibb']) + W['HBP']*s['hbp'] + W['S']*s['s1'] + W['D']*s['d2'] + W['T']*s['t3'] + W['HR']*s['hr']
        def wden(s): return s['ab'] + s['bb'] - s['ibb'] + s['sf'] + s['hbp']
        L = collections.Counter()
        for s in bs:
            for k in ('ab','h','s1','d2','t3','hr','bb','ibb','hbp','sf','sh','pa','so','sb','cs','r'): L[k] += s[k]
            L['wnum'] += wnum(s); L['wden'] += wden(s)

        # ---- pitching base
        ps = []
        for x in P:
            outs = i(x['outs'])
            if outs == 0 and i(x['g']) == 0: continue
            ps.append(dict(x=x, outs=outs, h=i(x['h']), r=i(x['r']), er=i(x['er']), hr=i(x['hr']), bb=i(x['bb']),
                           ibb=i(x['ibb']), so=i(x['so']), hbp=i(x['hbp']), g=i(x['g']), gs=i(x['gs'])))
        LP = collections.Counter()
        for s in ps:
            for k in ('outs','h','r','er','hr','bb','so','hbp'): LP[k] += s[k]
        lg_ip = LP['outs'] / 3

        if L['pa'] < 200 or lg_ip < 50:
            continue  # division didn't keep enough stats to set a league context
        lgwOBA = L['wnum'] / L['wden']
        lgRPA = L['r'] / L['pa']
        lgERA = 9 * LP['er'] / lg_ip
        lgRA9 = 9 * LP['r'] / lg_ip
        cFIP = lgERA - (13*LP['hr'] + 3*(LP['bb']+LP['hbp']) - 2*LP['so']) / lg_ip
        lgRIP = LP['r'] / lg_ip
        RPW = 9 * lgRIP * 1.5 + 3
        rPerOut = LP['r'] / LP['outs']
        runSB, runCS = 0.2, -(2 * rPerOut + 0.075)
        lgwSB = (L['sb']*runSB + L['cs']*runCS) / max(1, (L['s1'] + L['bb'] + L['hbp'] - L['ibb']))
        repPA = 570 * RPW / 185000  # FanGraphs' 570 position-player replacement wins over ~185k PA, rescaled to this run environment
        lgAVG = L['h']/L['ab']; lgOBP = (L['h']+L['bb']+L['hbp'])/(L['ab']+L['bb']+L['hbp']+L['sf'])
        lgSLG = (L['s1'] + 2*L['d2'] + 3*L['t3'] + 4*L['hr'])/L['ab']
        teams = {x['teamId'] for x in B} | {x['teamId'] for x in P}
        guts.append({
            'key': f'{y}-{d}', 'Season': y, 'Division': d, 'Teams': len(teams),
            'PA': L['pa'], 'IP': ipnote(LP['outs']),
            'AVG': r(lgAVG,3), 'OBP': r(lgOBP,3), 'SLG': r(lgSLG,3),
            'wOBA': r(lgwOBA,6), 'wOBAScale': WOBA_SCALE,
            'wBB': W['BB'], 'wHBP': W['HBP'], 'w1B': W['S'], 'w2B': W['D'], 'w3B': W['T'], 'wHR': W['HR'],
            'R/PA': r(lgRPA,6), 'R/G': r(9*lgRIP,2), 'ERA': r(lgERA,5), 'RA9': r(lgRA9,5), 'cFIP': r(cFIP,5),
            'R/W': r(RPW,5), 'runSB': runSB, 'runCS': r(runCS,5), 'repR/PA': r(repPA,6), 'lgwSB': r(lgwSB,6),
        })

        # ---- batting rows
        for s in bs:
            x = s['x']; pa = s['pa']; tg = i(x['teamGames'])
            woba = div0(wnum(s), wden(s))
            wraa = (woba - lgwOBA) / WOBA_SCALE * pa if woba is not None else 0
            wsb = s['sb']*runSB + s['cs']*runCS - lgwSB*(s['s1'] + s['bb'] + s['hbp'] - s['ibb'])
            wrcp = 100 * (wraa/pa + lgRPA) / lgRPA if pa else None
            tb = s['s1'] + 2*s['d2'] + 3*s['t3'] + 4*s['hr']
            avg = div0(s['h'], s['ab']); obp = div0(s['h']+s['bb']+s['hbp'], s['ab']+s['bb']+s['hbp']+s['sf'])
            slg = div0(tb, s['ab'])
            bip = s['ab'] - s['so'] - s['hr'] + s['sf']
            bat_rows.append({
                'key': f"{y}-{x['playerId']}-{x['teamId']}", 'Season': y, 'pid': x['playerId'],
                'Name': f"{x['firstName'].strip()} {x['lastName'].strip()}", 'Team': x['teamName'].strip(), 'tid': x['teamId'],
                'Division': d, 'TG': tg, 'G': s['g'], 'PA': pa, 'AB': s['ab'], 'H': s['h'], '1B': s['s1'], '2B': s['d2'], '3B': s['t3'],
                'HR': s['hr'], 'R': s['r'], 'RBI': s['rbi'], 'BB': s['bb'], 'IBB': s['ibb'], 'SO': s['so'], 'HBP': s['hbp'],
                'SF': s['sf'], 'SH': s['sh'], 'GDP': s['gdp'], 'SB': s['sb'], 'CS': s['cs'],
                'BB%': r(100*s['bb']/pa,1) if pa else None, 'K%': r(100*s['so']/pa,1) if pa else None,
                'BB/K': r(div0(s['bb'], s['so']),2),
                'AVG': r(avg,3), 'OBP': r(obp,3), 'SLG': r(slg,3), 'OPS': r((obp or 0)+(slg or 0),3) if pa else None,
                'ISO': r(slg-avg,3) if s['ab'] else None, 'BABIP': r(div0(s['h']-s['hr'], bip),3) if bip > 0 else None,
                'wOBA': r(woba,3), 'wRAA': r(wraa,1), 'wSB': r(wsb,1), 'wRC': r(wraa + lgRPA*pa,1),
                'wRC+': r(wrcp,0) if wrcp is not None else None, 'Off': r(wraa+wsb,1),
                'oWAR': r((wraa + wsb + repPA*pa)/RPW,1),
                'oWAR/600': r((wraa + wsb + repPA*pa)/RPW * 600/pa,1) if pa else None,
                'Qual': pa >= QUAL_PA_PER_G * tg,
                '_lgRPA': lgRPA,
            })

        # ---- pitching rows
        for s in ps:
            x = s['x']; outs = s['outs']; ip = outs/3; tg = i(x['teamGames'])
            tbf = outs + s['h'] + s['bb'] + s['hbp']
            fip = (13*s['hr'] + 3*(s['bb']+s['hbp']) - 2*s['so'])/ip + cFIP if ip else None
            era = 9*s['er']/ip if ip else None
            war = None
            if ip:
                fipr9 = fip + (lgRA9 - lgERA)
                ipg = ip / max(1, s['g'])
                drpw = ((((18 - ipg)*lgRA9 + ipg*fipr9)/18) + 2) * 1.5
                gsr = s['gs']/max(1, s['g'])
                repl = 0.03*(1-gsr) + 0.12*gsr
                war = ((lgRA9 - fipr9)/drpw + repl) * ip/9
            lobden = s['h'] + s['bb'] + s['hbp'] - 1.4*s['hr']
            bip = s['h'] - s['hr'] + outs - s['so']
            pit_rows.append({
                'key': f"{y}-{x['playerId']}-{x['teamId']}", 'Season': y, 'pid': x['playerId'],
                'Name': f"{x['firstName'].strip()} {x['lastName'].strip()}", 'Team': x['teamName'].strip(), 'tid': x['teamId'],
                'Division': d, 'TG': tg, 'W': i(x['w']), 'L': i(x['l']), 'SV': i(x['sv']), 'HLD': i(x['hld']),
                'G': s['g'], 'GS': s['gs'], 'CG': i(x['cg']), 'SHO': i(x['sho']), 'IP': ipnote(outs), 'Outs': outs, 'TBF': tbf,
                'H': s['h'], 'R': s['r'], 'ER': s['er'], 'HR': s['hr'], 'BB': s['bb'], 'IBB': s['ibb'], 'SO': s['so'], 'HBP': s['hbp'],
                'WP': i(x['wp']),
                'K/9': r(9*s['so']/ip,2) if ip else None, 'BB/9': r(9*s['bb']/ip,2) if ip else None,
                'HR/9': r(9*s['hr']/ip,2) if ip else None,
                'K%': r(100*s['so']/tbf,1) if tbf else None, 'BB%': r(100*s['bb']/tbf,1) if tbf else None,
                'K-BB%': r(100*(s['so']-s['bb'])/tbf,1) if tbf else None,
                'AVG': r(div0(s['h'], tbf - s['bb'] - s['hbp']),3) if tbf - s['bb'] - s['hbp'] > 0 else None,
                'WHIP': r((s['h']+s['bb'])/ip,2) if ip else None,
                'BABIP': r(div0(s['h']-s['hr'], bip),3) if bip > 0 else None,
                'LOB%': r(100*(s['h']+s['bb']+s['hbp']-s['r'])/lobden,1) if lobden > 0 else None,
                'ERA': r(era,2), 'FIP': r(fip,2),
                'ERA-': r(100*era/lgERA,0) if ip else None, 'FIP-': r(100*fip/lgERA,0) if ip else None,
                'E-F': r(era-fip,2) if ip else None,
                'WAR': r(war,1),
                'WAR/200': r(war * 200/ip,1) if (war is not None and ip) else None,
                'Qual': ip >= QUAL_IP_PER_G * tg,
                '_lgERA': lgERA,
            })

        # ---- standings (regular season only)
        rec = collections.defaultdict(lambda: collections.Counter())
        names = {}
        champ = None
        reg = [g for g in G if g['playoffRound'] == '0' and g['outcome'] == 'finished']
        div_tids = {x['teamId'] for x in B} | {x['teamId'] for x in P}
        for g in reg:
            for side, opp in (('home','away'), ('away','home')):
                tid = g[side+'Id']
                if g[side+'Division'] != d: continue
                names[tid] = g[side+'Name']
                rs, ra = i(g[side+'Runs']), i(g[opp+'Runs'])
                c = rec[tid]; c['GP'] += 1; c['RS'] += rs; c['RA'] += ra
                res = g['result']
                if res == 'tie': c['T'] += 1
                elif res == f'{side}_win': c['W'] += 1
                elif res == f'{opp}_win': c['L'] += 1
        po = [g for g in G if g['playoffRound'] not in ('0', None, '') and g['outcome'] == 'finished' and g['result'] in ('home_win','away_win')]
        if po:
            top = max(int(g['playoffRound']) for g in po)
            last = max((g for g in po if int(g['playoffRound']) == top),
                       key=lambda g: datetime.datetime.strptime(g['dateTime'], '%b %d %Y, %I:%M %p'))
            champ = last['homeId'] if last['result'] == 'home_win' else last['awayId']
        tb = collections.defaultdict(lambda: collections.Counter()); tp = collections.defaultdict(lambda: collections.Counter())
        for b in bat_rows:
            if b['Season'] == y and b['Division'] == d:
                t = tb[b['tid']]; t['PA'] += b['PA']; t['wRAA'] += b['wRAA'] or 0; t['oWAR'] += b['oWAR'] or 0
                t['HR'] += b['HR']; t['SB'] += b['SB']
        for p in pit_rows:
            if p['Season'] == y and p['Division'] == d:
                t = tp[p['tid']]; t['outs'] += p['Outs']; t['er'] += p['ER']
                t['fipn'] += 13*p['HR'] + 3*(p['BB']+p['HBP']) - 2*p['SO']; t['WAR'] += p['WAR'] or 0; t['SO'] += p['SO']; t['BB'] += p['BB']
        rows = []
        for tid, c in rec.items():
            dec = c['W'] + c['L']
            pct = (c['W'] + 0.5*c['T'])/c['GP'] if c['GP'] else 0
            rpg = (c['RS']+c['RA'])/c['GP'] if c['GP'] else 0
            exp = rpg ** 0.287 if rpg else 1.83
            py = c['RS']**exp/(c['RS']**exp + c['RA']**exp) if (c['RS'] or c['RA']) else 0.5
            bt, pt = tb[tid], tp[tid]
            ip = pt['outs']/3
            rows.append({
                'key': f'{y}-{tid}', 'Season': y, 'Division': d, 'tid': tid, 'Team': names[tid].strip(),
                'GP': c['GP'], 'W': c['W'], 'L': c['L'], 'T': c['T'], 'Pct': r(pct,3),
                'RS': c['RS'], 'RA': c['RA'], 'Diff': c['RS']-c['RA'], 'RS/G': r(c['RS']/c['GP'],2), 'RA/G': r(c['RA']/c['GP'],2),
                'pythW': r(py*c['GP'],1), 'pythL': r((1-py)*c['GP'],1), 'Luck': r(c['W'] + 0.5*c['T'] - py*c['GP'],1),
                'wRC+': r(100*(bt['wRAA']/bt['PA'] + lgRPA)/lgRPA,0) if bt['PA'] else None,
                'HR': bt['HR'], 'SB': bt['SB'],
                'ERA': r(9*pt['er']/ip,2) if ip else None,
                'FIP': r(pt['fipn']/ip + cFIP,2) if ip else None,
                'K/9': r(9*pt['SO']/ip,2) if ip else None, 'BB/9': r(9*pt['BB']/ip,2) if ip else None,
                'oWAR': r(bt['oWAR'],1), 'pWAR': r(pt['WAR'],1),
                'Champion': tid == champ,
            })
        rows.sort(key=lambda z: (-z['Pct'], -z['Diff']))
        if rows:
            lead = rows[0]
            for z in rows:
                gb = ((lead['W'] - z['W']) + (z['L'] - lead['L']))/2
                z['GB'] = r(gb,1)
                z['Rank'] = rows.index(z) + 1
        standings += rows

# ---- careers (sum over every season in the file, all teams/divisions)
def career_bat():
    by = collections.defaultdict(list)
    for b in bat_rows: by[b['pid']].append(b)
    out = []
    for pid, L in by.items():
        S = collections.Counter()
        for b in L:
            for k in ('G','PA','AB','H','1B','2B','3B','HR','R','RBI','BB','IBB','SO','HBP','SF','SH','GDP','SB','CS'): S[k] += b[k]
            S['wRAA'] += b['wRAA'] or 0; S['wSB'] += b['wSB'] or 0; S['oWAR'] += b['oWAR'] or 0; S['TG'] += b['TG']
            S['lgR'] += b['_lgRPA'] * b['PA']
            S['wnum'] += (b['wOBA'] or 0) * (b['AB'] + b['BB'] - b['IBB'] + b['SF'] + b['HBP'])
            S['wden'] += b['AB'] + b['BB'] - b['IBB'] + b['SF'] + b['HBP']
        pa, ab = S['PA'], S['AB']
        last = max(L, key=lambda b: (b['Season'], b['PA']))
        yrs = sorted({b['Season'] for b in L})
        tb = S['1B'] + 2*S['2B'] + 3*S['3B'] + 4*S['HR']
        avg = div0(S['H'], ab); obp = div0(S['H']+S['BB']+S['HBP'], ab+S['BB']+S['HBP']+S['SF']); slg = div0(tb, ab)
        bip = ab - S['SO'] - S['HR'] + S['SF']
        out.append({
            'key': pid, 'pid': pid, 'Name': last['Name'], 'Team': last['Team'], 'tid': last['tid'], 'Division': last['Division'],
            'Seasons': len(yrs), 'From': yrs[0], 'To': yrs[-1],
            **{k: S[k] for k in ('G','PA','AB','H','1B','2B','3B','HR','R','RBI','BB','IBB','SO','HBP','SF','SH','GDP','SB','CS')},
            'BB%': r(100*S['BB']/pa,1) if pa else None, 'K%': r(100*S['SO']/pa,1) if pa else None,
            'BB/K': r(div0(S['BB'], S['SO']),2),
            'AVG': r(avg,3), 'OBP': r(obp,3), 'SLG': r(slg,3), 'OPS': r((obp or 0)+(slg or 0),3) if pa else None,
            'ISO': r(slg-avg,3) if ab else None, 'BABIP': r(div0(S['H']-S['HR'], bip),3) if bip > 0 else None,
            'wOBA': r(div0(S['wnum'], S['wden']),3), 'wRAA': r(S['wRAA'],1), 'wSB': r(S['wSB'],1),
            'wRC': r(S['wRAA'] + S['lgR'],1),
            'wRC+': r(100*(S['wRAA'] + S['lgR'])/S['lgR'],0) if S['lgR'] else None,
            'Off': r(S['wRAA'] + S['wSB'],1), 'oWAR': r(S['oWAR'],1),
            'oWAR/600': r(S['oWAR'] * 600/pa,1) if pa else None,
            'Qual': pa >= 150,
        })
    return out

def career_pit():
    by = collections.defaultdict(list)
    for p in pit_rows: by[p['pid']].append(p)
    out = []
    for pid, L in by.items():
        S = collections.Counter()
        for p in L:
            for k in ('W','L','SV','HLD','G','GS','CG','SHO','Outs','TBF','H','R','ER','HR','BB','IBB','SO','HBP','WP'): S[k] += p[k]
            ip = p['Outs']/3
            S['fipip'] += (p['FIP'] or 0) * ip; S['WAR'] += p['WAR'] or 0; S['lgERAip'] += p['_lgERA'] * ip; S['TG'] += p['TG']
        outs = S['Outs']; ip = outs/3; tbf = S['TBF']
        last = max(L, key=lambda p: (p['Season'], p['Outs']))
        yrs = sorted({p['Season'] for p in L})
        era = 9*S['ER']/ip if ip else None; fip = S['fipip']/ip if ip else None; lgera = S['lgERAip']/ip if ip else None
        lobden = S['H'] + S['BB'] + S['HBP'] - 1.4*S['HR']; bip = S['H'] - S['HR'] + outs - S['SO']
        out.append({
            'key': pid, 'pid': pid, 'Name': last['Name'], 'Team': last['Team'], 'tid': last['tid'], 'Division': last['Division'],
            'Seasons': len(yrs), 'From': yrs[0], 'To': yrs[-1],
            **{k: S[k] for k in ('W','L','SV','HLD','G','GS','CG','SHO')}, 'IP': ipnote(outs), 'Outs': outs, 'TBF': tbf,
            **{k: S[k] for k in ('H','R','ER','HR','BB','IBB','SO','HBP','WP')},
            'K/9': r(9*S['SO']/ip,2) if ip else None, 'BB/9': r(9*S['BB']/ip,2) if ip else None, 'HR/9': r(9*S['HR']/ip,2) if ip else None,
            'K%': r(100*S['SO']/tbf,1) if tbf else None, 'BB%': r(100*S['BB']/tbf,1) if tbf else None,
            'K-BB%': r(100*(S['SO']-S['BB'])/tbf,1) if tbf else None,
            'AVG': r(div0(S['H'], tbf - S['BB'] - S['HBP']),3) if tbf - S['BB'] - S['HBP'] > 0 else None,
            'WHIP': r((S['H']+S['BB'])/ip,2) if ip else None,
            'BABIP': r(div0(S['H']-S['HR'], bip),3) if bip > 0 else None,
            'LOB%': r(100*(S['H']+S['BB']+S['HBP']-S['R'])/lobden,1) if lobden > 0 else None,
            'ERA': r(era,2), 'FIP': r(fip,2),
            'ERA-': r(100*era/lgera,0) if ip else None, 'FIP-': r(100*fip/lgera,0) if ip else None,
            'E-F': r(era-fip,2) if ip else None, 'WAR': r(S['WAR'],1),
            'WAR/200': r(S['WAR'] * 200/ip,1) if ip else None,
            'Qual': ip >= 50,
        })
    return out

bc, pc = career_bat(), career_pit()
for rows in (bat_rows, pit_rows):
    for z in rows:
        z.pop('_lgRPA', None); z.pop('_lgERA', None)

import csv
def dump(name, rows):
    p = os.path.join(OUT, name)
    if name.endswith('.csv'):
        cols = list(rows[0].keys())
        with open(p, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(cols)
            for z in rows:
                w.writerow(['' if z.get(c) is None else ('true' if z[c] is True else 'false' if z[c] is False else z[c]) for c in cols])
    else:
        json.dump(rows, open(p, 'w'), separators=(',', ':'))
    print(name, len(rows), f'{os.path.getsize(p)/1e6:.2f} MB')

dump('pssbl_batting.csv', bat_rows)
dump('pssbl_pitching.csv', pit_rows)
dump('pssbl_batting_career.csv', bc)
dump('pssbl_pitching_career.csv', pc)
dump('pssbl_standings.json', standings)
dump('pssbl_guts.json', guts)
print('relabeled', dict(sorted(RELABELED.items())), sum(RELABELED.values()))
