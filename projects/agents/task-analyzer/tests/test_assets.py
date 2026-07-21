import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def frontmatter(p: Path) -> dict:
    text = p.read_text()
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert m, f"{p} missing frontmatter"
    out = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip()
    return out

class TestAssets(unittest.TestCase):
    def test_rubrics_present_and_versioned(self):
        for name, marker in [
            ("complexity.md", "C7"),           # has all seven dims
            ("grading.md", "rounds"),          # mentions rounds-to-accept
            ("phase-taxonomy.md", "selfcheck") # includes the selfcheck phase
        ]:
            p = ROOT / "rubrics" / name
            fm = frontmatter(p)
            self.assertEqual(fm["version"], "1")
            self.assertIn(marker, p.read_text())

    def test_prompts_reference_rubrics(self):
        for name in ["complexity.md", "grading.md", "phase-labeling.md"]:
            fm = frontmatter(ROOT / "prompts" / name)
            self.assertEqual(fm["version"], "1")
            self.assertTrue((ROOT / fm["uses_rubric"]).exists())

if __name__ == "__main__":
    unittest.main()
