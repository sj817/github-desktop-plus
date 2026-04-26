import json, os, re, glob

LOCALE_DIR = "locales/zh-CN"
CJK = re.compile(r"[\u4e00-\u9fff]")
ALPHA = re.compile(r"[A-Za-z]")
PROPER_NOUNS = {"github","git","readme.md","atom","gpg","ssh","https","http","oauth","saml","lfs","promise","ok","true","false","null","yes","no","url","uri","api","json","xml","html","css","js","ts","npm","node","readme","license","todo"}

def is_placeholder_only(v):
    # remove placeholders like {x}, %s, %d, ${x}, <x>, numbers, punctuation
    stripped = re.sub(r"\{[^}]*\}|\$\{[^}]*\}|%[sd]|<[^>]+>|[\d\s\W_]+", "", v)
    return stripped == ""

def tokens_are_proper(v):
    # split into word tokens
    toks = re.findall(r"[A-Za-z][A-Za-z0-9.]*", v)
    if not toks: return False
    return all(t.lower() in PROPER_NOUNS for t in toks)

def walk(obj, path, out):
    if isinstance(obj, dict):
        for k,v in obj.items():
            if k == "_meta": continue
            walk(v, path+[k], out)
    elif isinstance(obj, list):
        for i,v in enumerate(obj):
            walk(v, path+[str(i)], out)
    elif isinstance(obj, str):
        out.append((".".join(path), obj))

suspicious = []
per_file = {}
files = sorted(glob.glob(os.path.join(LOCALE_DIR, "*.json")))
for fp in files:
    with open(fp, "r", encoding="utf-8") as f:
        data = json.load(f)
    entries = []
    walk(data, [], entries)
    cnt = 0
    for k,v in entries:
        if CJK.search(v): continue
        if not ALPHA.search(v): continue
        if len(v) <= 4: continue
        if is_placeholder_only(v): continue
        if tokens_are_proper(v): continue
        suspicious.append((os.path.basename(fp), k, v))
        cnt += 1
    per_file[os.path.basename(fp)] = cnt

print(f"Total suspicious entries: {len(suspicious)}")
print()
print("Per-file count:")
for f,c in sorted(per_file.items(), key=lambda x:-x[1]):
    print(f"  {f}: {c}")
print()
print("First 40 suspicious entries:")
for fn,k,v in suspicious[:40]:
    vs = v if len(v)<=120 else v[:117]+"..."
    print(f"  {fn}:{k} = {vs}")
