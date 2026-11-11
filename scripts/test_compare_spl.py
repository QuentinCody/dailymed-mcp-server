import tempfile
import unittest
from pathlib import Path
from compare_spl import compare, load_spl

SETID = "9aa7140c-012c-4ea6-866d-4732e915dab6"
DOCID = "1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8"


def xml(version, text="Old warning", extra="", setid=SETID):
    return f'<document xmlns="urn:hl7-org:v3"><id root="{DOCID}"/><setId root="{setid}"/><versionNumber value="{version}"/><effectiveTime value="20260801"/><component><section><code code="34066-1" codeSystem="2.16.840.1.113883.6.1"/><title>Boxed warning</title><text>{text}</text></section>{extra}</component></document>'


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def load(self, data, name="label.xml", checksum=None):
        path = Path(self.temp.name) / name
        path.write_text(data, encoding="utf-8")
        return load_spl(path, checksum)

    def test_text_change_retains_all_text_and_dates(self):
        result = compare(self.load(xml(1)), self.load(xml(2, "New warning"), "new.xml"))
        group = result["section_groups"][0]
        self.assertEqual(group["status"], "changed")
        self.assertFalse(group["text_unchanged"])
        self.assertIn("Old warning", group["before"][0]["text"])
        self.assertIn("New warning", group["after"][0]["text"])
        self.assertFalse(result["clinical_significance_assessed"])
        self.assertEqual(result["before"]["effective_time"], "20260801")

    def test_markup_only_change(self):
        result = compare(self.load(xml(1, "Warning")), self.load(xml(2, '<content styleCode="bold">Warning</content>'), "new.xml"))
        self.assertEqual(result["section_groups"][0]["status"], "changed")
        self.assertTrue(result["section_groups"][0]["text_unchanged"])

    def test_repeated_codes_are_not_arbitrarily_paired(self):
        extra = '<section><code code="34066-1" codeSystem="2.16.840.1.113883.6.1"/><text>second</text></section>'
        result = compare(self.load(xml(1)), self.load(xml(2, extra=extra), "new.xml"))
        self.assertTrue(result["section_groups"][0]["repeated_code"])
        self.assertEqual(len(result["section_groups"][0]["after"]), 2)

    def test_added_removed_and_unchanged(self):
        extra = '<section><code code="other"/><text>Other</text></section>'
        result = compare(self.load(xml(1)), self.load(xml(2, extra=extra), "new.xml"))
        self.assertEqual({g["status"] for g in result["section_groups"]}, {"added", "unchanged"})
        result = compare(self.load(xml(1, extra=extra)), self.load(xml(2), "new.xml"))
        self.assertEqual({g["status"] for g in result["section_groups"]}, {"removed", "unchanged"})

    def test_namespace_prefixes(self):
        prefixed = xml(2).replace("<document", "<h:document").replace("</document>", "</h:document>").replace('xmlns=', 'xmlns:h=')
        for name in ["id", "setId", "versionNumber", "effectiveTime", "component", "section", "code", "title", "text"]:
            prefixed = prefixed.replace("<" + name, "<h:" + name).replace("</" + name, "</h:" + name)
        self.assertEqual(self.load(prefixed)["setid"], SETID)

    def test_wrong_set_or_order(self):
        before = self.load(xml(2))
        with self.assertRaises(ValueError):
            compare(before, self.load(xml(3, setid=DOCID), "new.xml"))
        with self.assertRaises(ValueError):
            compare(before, self.load(xml(1), "new.xml"))

    def test_rejects_entities_and_wrong_root(self):
        for data in ['<!DOCTYPE document [<!ENTITY x "unsafe">]>' + xml(1), xml(1).replace("urn:hl7-org:v3", "urn:other")]:
            with self.assertRaises(ValueError):
                self.load(data)

    def test_duplicate_identity(self):
        with self.assertRaises(ValueError):
            self.load(xml(1).replace('<component>', f'<setId root="{SETID}"/><component>'))

    def test_hash_guard(self):
        before = self.load(xml(1))
        self.assertEqual(self.load(xml(1), checksum=before["sha256"])["sha256"], before["sha256"])
        with self.assertRaises(ValueError):
            self.load(xml(2), checksum=before["sha256"])

    def test_input_bound(self):
        with self.assertRaises(ValueError):
            self.load("x" * (8 * 1024 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
