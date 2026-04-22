#!/usr/bin/env python3
"""
全面扫描 GitHub Desktop 源码中所有用户可见的英文字符串。
翻译机制拦截：
  1. 所有文本节点（JSX 标签间的文本）
  2. title、placeholder、aria-label 属性

输出未翻译字符串，按目录分组。
"""

import os
import re
import json
import sys
from pathlib import Path
from collections import defaultdict

UI_DIR = Path(r"d:\Github\github-desktop\app\src\ui")
LOCALE_DIR = Path(r"d:\Github\github-desktop-plus\locales\zh-CN")

def load_all_translations():
    keys = set()
    for f in sorted(LOCALE_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            def collect_keys(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k != "_meta":
                            keys.add(k)  # collect the English KEY, not the Chinese value
                            collect_keys(v)
            collect_keys(data)
        except Exception as e:
            print(f"Warning: could not load {f}: {e}", file=sys.stderr)
    return keys


def extract_jsx_text_and_attrs(content, filepath):
    results = []

    # Pattern 1: JSX 文本节点 - 大写字母开头
    jsx_text_re = re.compile(
        r'>\s*([A-Z][^<>{}\n]*?)\s*<',
        re.MULTILINE
    )
    for m in jsx_text_re.finditer(content):
        text = m.group(1).strip()
        if not text:
            continue
        lineno = content[:m.start()].count('\n') + 1
        results.append((lineno, 'text', text))

    # Pattern 2: title="...", placeholder="...", aria-label="..."
    attr_re = re.compile(
        r'\b(title|placeholder|aria-label)\s*=\s*"([^"]{2,200})"',
        re.IGNORECASE
    )
    for m in attr_re.finditer(content):
        attr = m.group(1).lower()
        text = m.group(2).strip()
        lineno = content[:m.start()].count('\n') + 1
        results.append((lineno, f'attr:{attr}', text))

    # Pattern 3: 其他常用可见 props
    prop_re = re.compile(
        r'\b(tooltip|label|summary|description|buttonContent|okButtonText|cancelButtonText|confirmButtonText)\s*=\s*"([^"]{2,200})"',
        re.IGNORECASE
    )
    for m in prop_re.finditer(content):
        prop = m.group(1)
        text = m.group(2).strip()
        lineno = content[:m.start()].count('\n') + 1
        results.append((lineno, f'prop:{prop}', text))

    return results


SKIP_PATTERNS = [
    re.compile(r'^https?://'),
    re.compile(r'^[a-z][a-z0-9_-]+(/[a-z0-9_-]+)+$'),
    re.compile(r'^[a-z][a-z0-9-_]*$'),
    re.compile(r'^[A-Z0-9_\-]+$'),
    re.compile(r'^&\w+;$'),
    re.compile(r'^[\d\s%px\.]+$'),
    re.compile(r'[=>{}\[\]()]'),
    re.compile(r'^--[a-z-]'),
    re.compile(r'^\d+\.\d+'),
    re.compile(r'^[a-z]+([A-Z][a-z]+)+$'),  # camelCase
]

SKIP_EXACT = {
    'GitHub', 'Git', 'GitHub Desktop', 'Desktop', 'SSH', 'HTTP', 'HTTPS',
    'HEAD', 'SHA', 'PR', 'CI', 'CD', 'OAuth', 'SAML', 'LFS', 'GPG',
    'macOS', 'Linux', 'Windows', 'ARM', 'x64', 'Mac',
    'TypeScript', 'JavaScript', 'React', 'Electron', 'Node',
    'VS Code', 'Visual Studio Code',
    'OK', 'Yes', 'No', 'true', 'false', 'null', 'undefined',
}

HAS_ALPHA = re.compile(r'[A-Za-z]')
HAS_CJK = re.compile(r'[\u4e00-\u9fff\u3000-\u303f]')

def is_valid_candidate(text):
    if not text or len(text) < 2:
        return False
    if HAS_CJK.search(text):
        return False
    if not HAS_ALPHA.search(text):
        return False
    if text in SKIP_EXACT:
        return False
    for pat in SKIP_PATTERNS:
        if pat.search(text):
            return False
    words = text.split()
    if len(words) == 1:
        word = words[0]
        if word.islower():
            return False
        if re.match(r'^[a-z][a-z0-9_-]+$', word):
            return False
    return True


def get_section(filepath):
    rel = filepath.relative_to(UI_DIR)
    parts = rel.parts
    return parts[0] if len(parts) > 1 else "root"


def main():
    print("=== GitHub Desktop 源码英文字符串全面扫描 ===\n")
    
    print("加载已有翻译...")
    translations = load_all_translations()
    print(f"已加载 {len(translations)} 个翻译字符串\n")

    all_files = sorted(
        list(UI_DIR.rglob("*.tsx")) +
        [f for f in UI_DIR.rglob("*.ts") if not f.name.endswith('.d.ts')]
    )
    print(f"扫描 {len(all_files)} 个源文件...\n")

    section_results = defaultdict(lambda: {'untranslated': [], 'translated': []})
    total_files = 0

    for filepath in all_files:
        try:
            content = filepath.read_text(encoding='utf-8', errors='ignore')
            items = extract_jsx_text_and_attrs(content, filepath)
            section = get_section(filepath)
            rel_path = str(filepath.relative_to(UI_DIR))
            total_files += 1

            seen_in_file = set()
            for (lineno, kind, text) in items:
                if not is_valid_candidate(text):
                    continue
                if text in seen_in_file:
                    continue
                seen_in_file.add(text)

                bucket = 'translated' if text in translations else 'untranslated'
                section_results[section][bucket].append({
                    'file': rel_path,
                    'line': lineno,
                    'type': kind,
                    'text': text,
                })
        except Exception as e:
            print(f"  [错误] {filepath}: {e}", file=sys.stderr)

    grand_untrans = 0
    grand_trans = 0
    output_parts = []

    for section in sorted(section_results.keys()):
        data = section_results[section]
        untrans = data['untranslated']
        trans = data['translated']
        grand_untrans += len(untrans)
        grand_trans += len(trans)

        if not untrans:
            continue

        seen = set()
        deduped = []
        for item in untrans:
            if item['text'] not in seen:
                seen.add(item['text'])
                deduped.append(item)

        block = [f"\n{'='*70}"]
        block.append(f"  [{section}]  {len(deduped)} 条未翻译")
        block.append(f"{'='*70}")
        for item in deduped:
            block.append(f"  {item['file']}:{item['line']}  [{item['type']}]")
            block.append(f"    {repr(item['text'])}")
        output_parts.append('\n'.join(block))

    summary = [
        f"\n{'='*70}",
        f"  汇总: {grand_untrans} 条未翻译 / {grand_trans} 条已翻译",
        f"  覆盖文件: {total_files} 个",
        f"{'='*70}",
    ]

    full_output = '\n'.join(output_parts) + '\n' + '\n'.join(summary)
    print(full_output)

    out_path = Path(r"d:\Github\github-desktop-plus\scripts\scan-results.txt")
    out_path.write_text(full_output, encoding='utf-8')
    print(f"\n结果已保存到: {out_path}")


if __name__ == '__main__':
    main()
