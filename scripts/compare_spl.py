#!/usr/bin/env python3
"""Compare two locally supplied SPL revisions without fetching or interpreting care.

Requires the same set ID and increasing versions. Output keeps document hashes,
raw date references and all section text; repeated codes are compared as groups,
not paired by an invented identity. XML differences do not establish clinical risk.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

NS = "{urn:hl7-org:v3}"
UUID = re.compile(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\Z")
MAX_BYTES = 8 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def spl_sections(root):
    sections = {}
    size = 0
    for section in root.iter(NS + "section"):
        codes = section.findall(NS + "code")
        if len(codes) > 1:
            raise ValueError("Multiple direct codes in a section")
        code = codes[0].get("code") if codes else None
        system = codes[0].get("codeSystem") if codes else None
        key = json.dumps([system, code], separators=(",", ":"))
        standalone = copy.deepcopy(section)
        standalone.tail = None
        canonical = ET.canonicalize(ET.tostring(standalone, encoding="unicode"))
        narrative = " ".join(" ".join(section.itertext()).split())
        size += len(canonical.encode()) + len(narrative.encode())
        if size > 32 * 1024 * 1024:
            raise ValueError("Expanded section comparison exceeds 32 MiB")
        sections.setdefault(key, []).append({
            "code": code, "code_system": system,
            "title": " ".join(" ".join(section.find(NS + "title").itertext()).split()) if section.find(NS + "title") is not None else None,
            "text": narrative, "text_sha256": digest(narrative.encode()),
            "canonical_xml_sha256": digest(canonical.encode()),
        })
    return sections


def load_spl(path, expected_hash=None):
    with Path(path).open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("SPL input exceeds 8 MiB")
    if expected_hash and (not re.fullmatch(r"[a-fA-F0-9]{64}", expected_hash) or digest(raw) != expected_hash.lower()):
        raise ValueError("SPL checksum differs from expected SHA-256")
    # Decode before checking so UTF-16 bytes cannot hide an entity declaration.
    text = raw.decode("utf-8-sig")
    if re.search(r"<!\s*(DOCTYPE|ENTITY)\b", text, re.I):
        raise ValueError("DTD and entity declarations are not supported")
    root = ET.fromstring(text)
    if root.tag != NS + "document":
        raise ValueError("Expected an HL7 SPL document")
    stack = [(root, 0)]
    nodes = 0
    while stack:
        node, depth = stack.pop()
        nodes += 1
        if depth > 128 or nodes > 200000:
            raise ValueError("SPL tree exceeds depth/node bound")
        stack.extend((child, depth + 1) for child in node)

    def field(name, attr, required=True):
        found = root.findall(NS + name)
        if len(found) > 1 or (required and len(found) != 1):
            raise ValueError(f"Missing/duplicate document {name}")
        value = found[0].get(attr) if found else None
        if required and not value:
            raise ValueError(f"Missing document {name}/{attr}")
        return value

    setid, document_id = field("setId", "root"), field("id", "root")
    version = field("versionNumber", "value")
    if not UUID.fullmatch(setid) or not UUID.fullmatch(document_id) or not re.fullmatch(r"[1-9]\d*", version):
        raise ValueError("Invalid document set ID, ID or version")
    sections = spl_sections(root)
    return {"file": str(path), "sha256": digest(raw), "bytes": len(raw), "setid": setid.lower(),
            "document_id": document_id.lower(), "spl_version": version,
            "effective_time": field("effectiveTime", "value", False), "sections": sections}


def compare(before, after):
    if before["setid"] != after["setid"]:
        raise ValueError("Cannot compare labels from different set IDs")
    if int(before["spl_version"]) >= int(after["spl_version"]):
        raise ValueError("Expected increasing SPL versions")
    groups = []
    for key in sorted(before["sections"].keys() | after["sections"].keys()):
        left, right = before["sections"].get(key, []), after["sections"].get(key, [])
        unchanged = [x["canonical_xml_sha256"] for x in left] == [x["canonical_xml_sha256"] for x in right]
        text_unchanged = [x["text_sha256"] for x in left] == [x["text_sha256"] for x in right]
        groups.append({"code_system": json.loads(key)[0], "code": json.loads(key)[1],
                       "status": "unchanged" if unchanged else "added" if not left else "removed" if not right else "changed",
                       "text_unchanged": text_unchanged, "repeated_code": max(len(left), len(right)) > 1,
                       "before": left, "after": right})
    return {"setid": before["setid"], "before": {k: v for k, v in before.items() if k != "sections"},
            "after": {k: v for k, v in after.items() if k != "sections"}, "section_groups": groups,
            "clinical_significance_assessed": False,
            "limitations": ["Local files are not independently verified archive downloads; retain source URLs and publication dates separately.",
                            "effectiveTime is an SPL date reference, not DailyMed publication date or FDA approval date.",
                            "Section text normalizes whitespace; canonical XML hashes also detect markup/attribute changes. Original-file hashes preserve byte identity.",
                            "Repeated codes retain ordered arrays without inferred pairing; nested sections also occur in their parent text.",
                            "A revision or text difference does not establish a safety change or clinical significance."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--before-sha256")
    parser.add_argument("--after-sha256")
    args = parser.parse_args()
    try:
        result = compare(load_spl(args.before, args.before_sha256), load_spl(args.after, args.after_sha256))
    except (ValueError, OSError, ET.ParseError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
