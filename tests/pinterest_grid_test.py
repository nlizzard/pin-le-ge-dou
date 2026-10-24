"""Offline regression tests: python -m unittest discover -s tests -p '*_test.py'."""
import importlib.util
from io import BytesIO
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('grid', Path('tools/pinterest-grid.py'))
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)


class GridRecoveryTests(unittest.TestCase):
    def test_explicit_cells_ignore_chart_rules_and_preserve_white_details(self):
        colors = np.array([[[255, 0, 0], [255, 255, 255], [0, 0, 255]],
                           [[0, 0, 255], [255, 255, 255], [255, 0, 0]],
                           [[255, 0, 0], [255, 255, 255], [0, 0, 255]]], dtype=np.uint8)
        chart = np.repeat(np.repeat(colors, 20, 0), 20, 1)
        chart[::20] = 0
        chart[:, ::20] = 0
        file = BytesIO()
        Image.fromarray(chart).save(file, format='PNG')
        file.seek(0)
        p, meta = grid.convert(file, 'chart', 'chart', {'grid': [3, 3], 'keep': True})
        self.assertEqual(meta['method'], 'specified-grid')
        self.assertEqual(len(p['rows']), 3)
        for y, row in enumerate(p['rows']):
            for x, char in enumerate(row):
                self.assertEqual(p['palette'][char], '#'+''.join(f'{c:02x}' for c in colors[y, x]))

    def test_background_removal_preserves_enclosed_white(self):
        pixels = np.full((7, 7, 3), 255, dtype=np.uint8)
        pixels[1:6, 1:6] = [24, 24, 24]
        pixels[2:5, 2:5] = [255, 255, 255]
        p = grid.pattern_from_cells(pixels, 'ring', 'ring')
        self.assertEqual(len(p['rows']), 5)
        self.assertEqual(p['palette'][p['rows'][2][2]], '#ffffff')


if __name__ == '__main__':
    unittest.main()
