from __future__ import annotations

import ast
import os
import subprocess
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RenderHarnessTests(unittest.TestCase):
    def test_render_scripts_do_not_redefine_public_functions(self) -> None:
        for relative_path in (
            "scripts/render_agendaframe_outputs.py",
            "scripts/render_uml_diagrams.py",
            "scripts/build_agendaframe_submission.py",
        ):
            path = ROOT / relative_path
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            public_functions = [
                node.name
                for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and not node.name.startswith("_")
            ]
            duplicates = sorted(
                name for name, count in Counter(public_functions).items() if count > 1
            )
            self.assertEqual(duplicates, [], f"duplicate public functions in {relative_path}")

    def test_png_renderer_check_does_not_touch_reviewed_outputs(self) -> None:
        outputs = sorted((ROOT / "outputs").glob("*.png"))
        before = {path.name: (path.stat().st_size, path.stat().st_mtime_ns) for path in outputs}

        child_env = os.environ.copy()
        child_env["PYTHONUTF8"] = "1"
        result = subprocess.run(
            [sys.executable, "scripts/render_agendaframe_outputs.py", "--check"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=child_env,
        )

        output = (result.stdout or "") + (result.stderr or "")
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("render check passed", output)
        after = {path.name: (path.stat().st_size, path.stat().st_mtime_ns) for path in outputs}
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
