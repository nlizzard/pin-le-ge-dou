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

    def test_chart_trim_keeps_diagonal_outline_and_removes_separate_colour_key(self):
        pixels = np.full((24, 22, 3), 255, dtype=np.uint8)
        # The head and cheeks meet diagonally, as they commonly do in bead charts.
        for y, x in [(3, 8), (3, 9), (3, 10), (4, 7), (4, 11), (5, 6), (5, 12),
                     (6, 6), (6, 12), (7, 7), (7, 11), (8, 8), (8, 9), (8, 10)]:
            pixels[y, x] = [24, 24, 24]
        pixels[19:21, 2:19] = [210, 40, 90]  # The colour key is not part of the face.
        p = grid.pattern_from_cells(pixels, 'face', 'face', keep=True, trim=True)
        self.assertEqual(len(p['rows']), 6)
        self.assertEqual(max(map(len, p['rows'])), 7)
        self.assertIn('#ffffff', p['palette'].values())
        self.assertNotIn('#d2285a', p['palette'].values())


if __name__ == '__main__':
    unittest.main()
