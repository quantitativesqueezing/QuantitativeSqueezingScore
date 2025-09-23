
from typing import Dict, Iterable, List, Union
import sys, csv, argparse, io

FLOAT_BUCKETS = [
    (5_000_000, 35),
    (10_000_000, 30),
    (20_000_000, 25),
    (50_000_000, 15),
    (float("inf"), 5),
]

REGSHO_BONUS = 4

def apply_minimums_additive(score: float, float_shares: float, ctb: float, si_pct: float) -> float:
    if float_shares < 10_000_000 and ctb > 300:
        score = max(score, 91)
    if float_shares < 5_000_000 and ctb > 100:
        score = max(score, 88)
    if float_shares < 30_000_000 and ctb > 50 and si_pct >= 20:
        score = max(score, 85)
    return score

def apply_minimums_multiplicative(score: float, float_shares: float, ctb: float, si_pct: float) -> float:
    if float_shares < 10_000_000 and ctb > 300:
        score = max(score, 91)
    if float_shares < 5_000_000 and ctb > 100:
        score = max(score, 88)
    if float_shares < 30_000_000 and ctb > 50 and si_pct >= 20:
        score = max(score, 85)
    return score

def float_multiplier(float_shares: float) -> float:
    if float_shares < 5_000_000: return 3.0
    if float_shares < 10_000_000: return 2.5
    if float_shares < 20_000_000: return 2.0
    if float_shares < 50_000_000: return 1.5
    return 1.0

def ctb_multiplier(ctb: float) -> float:
    if ctb >= 500: return 3.0
    if ctb >= 300: return 2.7
    if ctb >= 100: return 2.0
    if ctb >= 50: return 1.6
    if ctb >= 25: return 1.3
    return 1.0

def si_multiplier(si_pct: float) -> float:
    if si_pct >= 50: return 2.5
    if si_pct >= 20: return 2.0
    if si_pct >= 10: return 1.5
    if si_pct >= 5: return 1.2
    return 1.0

def ftd_multiplier(ftd_val: float) -> float:
    if ftd_val >= 10_000_000: return 1.3
    if ftd_val >= 5_000_000: return 1.2
    if ftd_val >= 1_000_000: return 1.1
    return 1.0

def score_additive(float_shares: float, si_pct: float, ctb: float, ftd_val: float, regsho: bool) -> float:
    score = 0.0
    if float_shares < 5_000_000: score += 35
    elif float_shares < 10_000_000: score += 30
    elif float_shares < 20_000_000: score += 25
    elif float_shares < 50_000_000: score += 15
    else: score += 5

    if ctb >= 500: score += 24
    elif ctb >= 300: score += 23
    elif ctb >= 100: score += 19
    elif ctb >= 50: score += 14
    elif ctb >= 25: score += 10
    elif ctb >= 10: score += 5

    if si_pct >= 50: score += 25
    elif si_pct >= 20: score += 19
    elif si_pct >= 10: score += 14
    elif si_pct >= 5: score += 10

    if float_shares < 10_000_000 and si_pct >= 20: score += 8
    if float_shares < 5_000_000 and ctb > 100: score += 12
    if float_shares < 10_000_000 and ctb > 300: score += 8

    if ftd_val >= 10_000_000: score += 9
    elif ftd_val >= 5_000_000: score += 7
    elif ftd_val >= 1_000_000: score += 5

    if regsho: score += REGSHO_BONUS

    score = apply_minimums_additive(score, float_shares, ctb, si_pct)
    return min(score, 99.0)

def score_multiplicative(float_shares: float, si_pct: float, ctb: float, ftd_val: float, regsho: bool) -> float:
    raw = (
        float_multiplier(float_shares) *
        ctb_multiplier(ctb) *
        si_multiplier(si_pct) *
        ftd_multiplier(ftd_val) *
        (1.05 if regsho else 1.0)
    )
    score = (raw / 45.0) * 100.0
    score = apply_minimums_multiplicative(score, float_shares, ctb, si_pct)
    return min(score, 99.0)

def score_consensus(float_shares: float, os_shares: float, si_pct: float, ctb: float, ftd_val: float, regsho: bool) -> float:
    add_ = score_additive(float_shares, si_pct, ctb, ftd_val, regsho)
    mul_ = score_multiplicative(float_shares, si_pct, ctb, ftd_val, regsho)
    return round((add_ + mul_) / 2.0, 1)

def score_breakdown(float_shares: float, os_shares: float, si_pct: float, ctb: float, ftd_val: float, regsho: bool) -> Dict[str, float]:
    float_pts = 35 if float_shares < 5_000_000 else 30 if float_shares < 10_000_000 else 25 if float_shares < 20_000_000 else 15 if float_shares < 50_000_000 else 5
    ctb_pts = 24 if ctb >= 500 else 23 if ctb >= 300 else 19 if ctb >= 100 else 14 if ctb >= 50 else 10 if ctb >= 25 else 5 if ctb >= 10 else 0
    si_pts = 25 if si_pct >= 50 else 19 if si_pct >= 20 else 14 if si_pct >= 10 else 10 if si_pct >= 5 else 0

    bonus = 0
    if float_shares < 10_000_000 and si_pct >= 20: bonus += 8
    if float_shares < 5_000_000 and ctb > 100: bonus += 12
    if float_shares < 10_000_000 and ctb > 300: bonus += 8

    ftd_pts = 9 if ftd_val >= 10_000_000 else 7 if ftd_val >= 5_000_000 else 5 if ftd_val >= 1_000_000 else 0
    reg_pts = 4 if regsho else 0

    add_total = float_pts + ctb_pts + si_pts + bonus + ftd_pts + reg_pts
    add_total = apply_minimums_additive(add_total, float_shares, ctb, si_pct)
    add_total = min(add_total, 99.0)

    mul_total = score_multiplicative(float_shares, si_pct, ctb, ftd_val, regsho)
    consensus = round((add_total + mul_total) / 2.0, 1)

    return {
        "Float": float_pts,
        "CTB": ctb_pts,
        "SI%": si_pts,
        "Bonuses": bonus,
        "FTD": ftd_pts,
        "RegSHO": reg_pts,
        "Additive Total": round(add_total, 1),
        "Multiplicative Total": round(mul_total, 1),
        "Consensus": consensus,
    }

# ---------- CSV CLI ----------
def _to_bool(v: Union[str, int, float, bool]) -> bool:
    if isinstance(v, bool): return v
    s = str(v).strip().lower()
    return s in {"1","true","t","yes","y"}

def _float_or_zero(v) -> float:
    try:
        return float(str(v).replace(",","").strip())
    except:
        return 0.0

HEADER_ALIASES = {
    "ticker": {"ticker","symbol"},
    "float_shares": {"float_shares","free float","float","free_float"},
    "os_shares": {"os_shares","shares outstanding","outstanding","os","shares_outstanding"},
    "si_pct": {"si_pct","short float %","short %","short_percent","short_float_pct"},
    "ctb": {"ctb","cost to borrow","borrow cost","ctb%","cost_to_borrow"},
    "ftd_val": {"ftd_val","ftd $","ftd value","ftd","ftd_usd"},
    "regsho": {"regsho","reg sho","threshold","on_regsho"},
}

def _normalize_headers(fieldnames):
    # Build a mapping from canonical -> actual header name in the file
    fieldnames = [fn.strip() for fn in (fieldnames or [])]
    lower_map = {fn.lower(): fn for fn in fieldnames}
    mapping = {}
    for canon, aliases in HEADER_ALIASES.items():
        for a in aliases:
            if a.lower() in lower_map:
                mapping[canon] = lower_map[a.lower()]
                break
    return mapping

def main():
    ap = argparse.ArgumentParser(description="Short-squeeze scoring CLI (robust)")
    ap.add_argument("input", nargs="?", default="-", help="input CSV (default: stdin)")
    ap.add_argument("-o", "--output", default="-", help="output CSV (default: stdout)")
    ap.add_argument("--debug", action="store_true", help="print row-level errors to stderr")
    args = ap.parse_args()

    fin = sys.stdin if args.input == "-" else open(args.input, "r", newline="", encoding="utf-8-sig")
    data = fin.read()
    if fin is not sys.stdin: fin.close()

    # Sniff dialect to support semicolons/tabs
    try:
        dialect = csv.Sniffer().sniff(data.splitlines()[0] + "\n" + data.splitlines()[1])
    except Exception:
        dialect = csv.getdialect("excel")
    reader = csv.DictReader(io.StringIO(data), dialect=dialect)

    header_map = _normalize_headers(reader.fieldnames)
    out_fields = ["ticker","Consensus","Additive Total","Multiplicative Total","Float","CTB","SI%","Bonuses","FTD","RegSHO"]
    fout = sys.stdout if args.output == "-" else open(args.output, "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(fout, fieldnames=out_fields)
    writer.writeheader()

    idx = 0
    for row in reader:
        idx += 1
        try:
            def get(canon, default=""):
                actual = header_map.get(canon)
                return row.get(actual, default) if actual else default

            ticker = get("ticker","")
            float_shares = _float_or_zero(get("float_shares", 0))
            os_shares = _float_or_zero(get("os_shares", 0))
            si_pct = _float_or_zero(get("si_pct", 0))
            ctb = _float_or_zero(get("ctb", 0))
            ftd_val = _float_or_zero(get("ftd_val", 0))
            regsho = _to_bool(get("regsho", False))

            bd = score_breakdown(float_shares, os_shares, si_pct, ctb, ftd_val, regsho)
            bd["ticker"] = ticker
            writer.writerow(bd)
        except Exception as e:
            if args.debug:
                print(f"[row {idx}] error: {e} | row={row}", file=sys.stderr)

    if fout is not sys.stdout: fout.close()

if __name__ == "__main__":
    main()
