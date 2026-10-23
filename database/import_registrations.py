#!/usr/bin/env python3
"""Clean the KNUMLO Google Form export and generate import_members.sql + import_report.csv.
Usage: python3 import_registrations.py registrations.csv   (CSV, TSV or XLSX)
Nothing is approved here: everyone is imported as 'pending'. Officials approve afterwards."""
import csv, re, sys, datetime
CO = "Mombasa,Kwale,Kilifi,Tana River,Lamu,Taita-Taveta,Garissa,Wajir,Mandera,Marsabit,Isiolo,Meru,Tharaka-Nithi,Embu,Kitui,Machakos,Makueni,Nyandarua,Nyeri,Kirinyaga,Murang'a,Kiambu,Turkana,West Pokot,Samburu,Trans Nzoia,Uasin Gishu,Elgeyo-Marakwet,Nandi,Baringo,Laikipia,Nakuru,Narok,Kajiado,Kericho,Bomet,Kakamega,Vihiga,Bungoma,Busia,Siaya,Kisumu,Homa Bay,Migori,Kisii,Nyamira,Nairobi".split(",")
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())
KEYS = sorted([(norm(c), i + 1) for i, c in enumerate(CO)] + [("muranga", 21), ("homabay", 43), ("taitataveta", 6), ("tharakanithi", 13), ("elgeyomarakwet", 28), ("elgeiyomarakwet", 28), ("elgeyo", 28), ("uasingishu", 27), ("transnzoia", 26), ("transzoia", 26)], key=lambda x: -len(x[0]))
ALIAS = [("makadara", 47), ("kamukunji", 47), ("embakasi", 47), ("nairobicity", 47), ("kinango", 2), ("wundanyi", 6), ("chuka", 13), ("kapsabet", 29), ("iten", 28), ("marakwet", 28), ("kapenguria", 24), ("wote", 17), ("nanyuki", 31), ("nyahururu", 31), ("borabu", 46), ("kuria", 44), ("emc", 28), ("tnc", 13)]
def county(*texts):
    for t in texts:
        n = norm(t)
        if not n or n in ("option", "none", "national", "nad"): continue
        for k, i in KEYS:
            if k in n: return i
        for k, i in ALIAS:
            if k in n: return i
    return None
HOSP = [(r"\bmtrh\b|moi teaching", "MTRH"), (r"\bknh\b|kenyatta national", "KNH"), (r"kutrrh", "KUTRRH"), (r"joorth|jootrh|jaramogi oginga odinga teaching", "JOORTH"), (r"mntrh|mathari national", "MNTRH")]
def sector(ws, payroll):
    t = (ws or '').lower()
    for rx, c in HOSP:
        if re.search(rx, t): return "PAR", c
    if re.search(r"\bmission\b|\bagc\b|tenwek|st\.? ?mary", t): return "MISS", None
    if "private" in (payroll or '').lower() or "private" in t: return "PRI", None
    return "CPS", None
def phone(p):
    s = re.split(r'[/,;]', p or '')[0]
    s = re.sub(r'O(?=\d)', '0', s.upper())
    s = re.sub(r'[^\d+]', '', s)
    m = re.fullmatch(r'(?:\+?254|0)?([17]\d{8})', s)
    return "+254" + m.group(1) if m else None
def email(e):
    e = (e or '').strip().lower()
    return e if re.fullmatch(r"[^@\s.][^@\s]*@[^@\s]+\.[a-z]{2,}", e) and ".." not in e else None
def titled(s):
    s = re.sub(r'\s+', ' ', (s or '').strip())
    return s.title() if s.isupper() or s.islower() else s
def blank(v): return (v or '').strip().lower() in ("", "option 1", "none", "n/a", "na", "nil", "null", "0")
def q(v): return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"

def rows(path):
    if path.lower().endswith(".xlsx"):
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True).active
        it = [[("" if c is None else str(c)) for c in r] for r in ws.iter_rows(values_only=True)]
    else:
        txt = open(path, encoding="utf-8-sig").read()
        d = "\t" if txt.split("\n")[0].count("\t") > 2 else ","
        it = list(csv.reader(txt.splitlines(), delimiter=d))
    h = [norm(x) for x in it[0]]
    col = lambda *names: next(i for i, x in enumerate(h) if any(n in x for n in names))
    ix = dict(ts=col("timestamp"), name=col("fullname"), em=col("email"), ph=col("phone"), id=col("idnumber"), pay=col("payroll"), reg=col("kmlttb", "kmltb"), br=col("branch"), ws=col("workstation"))
    for r in it[1:]:
        if any(c.strip() for c in r):
            r += [""] * 10
            yield {k: r[v].strip() for k, v in ix.items()}

def main(path):
    groups, report = {}, []
    for r in rows(path):
        i = re.sub(r'\s', '', r["id"])
        if not re.fullmatch(r'\d{6,8}', i):
            report.append((r["id"], r["name"], "rejected", "ID number is not 6-8 digits; fix and re-import")); continue
        try: r["t"] = datetime.datetime.strptime(r["ts"], "%m/%d/%Y %H:%M:%S")
        except ValueError: r["t"] = datetime.datetime(2026, 10, 16)
        groups.setdefault(i, []).append(r)
    out, used_ph, used_em, imported = [], set(), set(), 0
    for i, g in sorted(groups.items(), key=lambda kv: min(x["t"] for x in kv[1])):
        g.sort(key=lambda x: x["t"]); last = g[-1]; notes = []
        pick = lambda f, ok=lambda v: not blank(v): next((x[f] for x in reversed(g) if ok(x[f])), "")
        br, ws = pick("br"), pick("ws")
        ph = next((phone(x["ph"]) for x in reversed(g) if phone(x["ph"])), None)
        em = next((email(x["em"]) for x in reversed(g) if email(x["em"])), None)
        if ph is None: notes.append("phone missing or invalid")
        elif ph in used_ph: ph = None; notes.append("phone already used by another member")
        if em is None: notes.append("email missing or invalid")
        elif em in used_em: em = None; notes.append("email already used by another member")
        used_ph.add(ph); used_em.add(em)
        if len(g) > 1: notes.append(f"{len(g)} form submissions merged")
        sec, emp = sector(ws, last["pay"])
        co = county(br, ws)
        if sec == "CPS": notes.append("sector assumed CPS; verify")
        review = co is None and sec != "PAR"
        if review: notes.append("county not identified")
        nm = titled(last["name"]).split(" ", 1)
        reg = re.sub(r'^A[O0]', 'A0', re.sub(r'\s', '', pick("reg").upper())) or None
        pay = last["pay"] if not blank(last["pay"]) and re.fullmatch(r'[\w/\-]+', last["pay"]) and "private" not in last["pay"].lower() else None
        emp_sql = f"(SELECT id FROM employers WHERE code={q(emp)})" if emp else "NULL"
        br_sql = f"(SELECT id FROM branches WHERE county_id={co} LIMIT 1)" if co else "NULL"
        out.append(f"INSERT INTO members (first_name,last_name,id_number,phone,email,kmltb_licence_no,payroll_no,sector_code,employer_id,county_id,branch_id,workstation,status,registered_at,needs_review,import_notes) VALUES ({q(nm[0])},{q(nm[1] if len(nm) > 1 else '-')},{q(i)},{q(ph)},{q(em)},{q(reg)},{q(pay)},{q(sec)},{emp_sql},{co or 'NULL'},{br_sql},{q(titled(ws) or None)},'pending',{q(g[0]['t'].strftime('%Y-%m-%d %H:%M:%S') + '+03')},{str(review).lower()},{q('; '.join(notes) or None)}) ON CONFLICT DO NOTHING;")
        report.append((i, last["name"], "imported", "; ".join(notes))); imported += 1
    open("import_members.sql", "w").write("-- Generated by import_registrations.py. Safe to re-run.\nBEGIN;\n" + "\n".join(out) + "\nCOMMIT;\n")
    with open("import_report.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["id_number", "name", "result", "notes"]); w.writerows(report)
    rej = sum(1 for r in report if r[2] == "rejected")
    flagged = sum(1 for r in report if r[2] == "imported" and r[3])
    print(f"{imported} members imported ({sum('county not identified' in r[3] for r in report)} need county review), {rej} rejected, {flagged} with notes. See import_report.csv")
main(sys.argv[1])
