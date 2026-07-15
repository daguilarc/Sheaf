import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
EXPERIMENT = REPO_ROOT / "projects/dictator/experiments/refiner-benchmark/prompts"
PRODUCTION = REPO_ROOT / "projects/dictator/src/prompts/system-prompts"


class RolloutConfigurationTests(unittest.TestCase):
    def test_selected_prompts_are_byte_identical_to_experiment_versions(self):
        selected = {
            "conservative_v4.md": "intent_refiner_conservative_v4.md",
            "blark_v3.md": "injectable_blark_casing_rules_v3.md",
            "borg_v4.md": "injectable_borg_refiner_instructions_v4.md",
        }
        for experiment_name, production_name in selected.items():
            with self.subTest(production=production_name):
                self.assertEqual(
                    (EXPERIMENT / experiment_name).read_bytes(),
                    (PRODUCTION / production_name).read_bytes(),
                )

    def test_runtime_selects_luna_low_and_versioned_prompts(self):
        config = json.loads((REPO_ROOT / "config/dictator.json").read_text())
        self.assertEqual(config["cloud_model"], "gpt-5.6-luna")
        self.assertEqual(config["reasoning_effort"], "low")
        self.assertEqual(config["system_prompt"], "intent_refiner_conservative_v4.md")
        self.assertEqual(
            config["injectable_rules"],
            {
                "blark": "injectable_blark_casing_rules_v3.md",
                "borg": "injectable_borg_refiner_instructions_v4.md",
            },
        )


if __name__ == "__main__":
    unittest.main()
