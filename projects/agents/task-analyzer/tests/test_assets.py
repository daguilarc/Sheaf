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

# Distinctive multi-word anchor strings copied verbatim from the ported
# section of analysis/sdd-model-analysis/rubrics.md, keyed by rubric file.
RUBRIC_ANCHORS = {
    "complexity.md": (
        "complexity",
        [
            "restructuring of existing dense logic",
            "brief contains the exact code/tests to write",
        ],
    ),
    "grading.md": (
        "grading",
        [
            "first-round PASS; no critical/important findings; G-scores ≥4",
            "critical finding, false verification claim, or abandoned task",
            "closer to raw reviewer evidence",
        ],
    ),
    "phase-taxonomy.md": (
        "phase-taxonomy",
        [
            "Re-reading own diff, self-review, checking against brief requirements",
            "fixing a bug the suite caught after green is `debug`, not `green`",
        ],
    ),
}

# Expected (uses_rubric, model_hint) per dispatch prompt.
PROMPT_EXPECTATIONS = {
    "complexity.md": ("rubrics/complexity.md", "sonnet"),
    "grading.md": ("rubrics/grading.md", "sonnet"),
    "phase-labeling.md": ("rubrics/phase-taxonomy.md", "haiku"),
}

PLACEHOLDERS = ["{{RUBRIC_PATH}}", "{{ITEMS_JSON_PATH}}", "{{OUTPUT_DIR}}"]

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

    def test_rubric_frontmatter_exact(self):
        for name, (kind, _anchors) in RUBRIC_ANCHORS.items():
            fm = frontmatter(ROOT / "rubrics" / name)
            self.assertEqual(fm["version"], "1")
            self.assertEqual(fm["kind"], kind)

    def test_rubric_anchor_fidelity(self):
        # Guards against silent drift in the ported rubric text: each rubric
        # must still contain load-bearing anchor sentences verbatim.
        for name, (_kind, anchors) in RUBRIC_ANCHORS.items():
            text = (ROOT / "rubrics" / name).read_text()
            for anchor in anchors:
                self.assertIn(anchor, text, f"{name} missing anchor: {anchor!r}")

    def test_prompts_reference_rubrics(self):
        for name in ["complexity.md", "grading.md", "phase-labeling.md"]:
            fm = frontmatter(ROOT / "prompts" / name)
            self.assertEqual(fm["version"], "1")
            self.assertTrue((ROOT / fm["uses_rubric"]).exists())

    def test_prompt_frontmatter_exact(self):
        for name, (uses_rubric, model_hint) in PROMPT_EXPECTATIONS.items():
            fm = frontmatter(ROOT / "prompts" / name)
            self.assertEqual(fm["version"], "1")
            self.assertEqual(fm["uses_rubric"], uses_rubric)
            self.assertEqual(fm["model_hint"], model_hint)

    def test_prompt_placeholders_present(self):
        for name in PROMPT_EXPECTATIONS:
            text = (ROOT / "prompts" / name).read_text()
            for placeholder in PLACEHOLDERS:
                self.assertIn(placeholder, text, f"{name} missing {placeholder}")

if __name__ == "__main__":
    unittest.main()
